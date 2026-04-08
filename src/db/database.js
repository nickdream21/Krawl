const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Ruta a la base de datos en AppData del usuario
const newDataPath = path.join(os.homedir(), 'AppData', 'Roaming', 'Krawl');
const oldDataPath = path.join(os.homedir(), 'AppData', 'Roaming', 'Gestor-Documentos-Sullana');

// Migrar datos del nombre anterior si existen
if (fs.existsSync(oldDataPath) && !fs.existsSync(newDataPath)) {
  fs.renameSync(oldDataPath, newDataPath);
  console.log('Datos migrados de Gestor-Documentos-Sullana a Krawl');
}

const userDataPath = newDataPath;
const sqlitePath = path.join(userDataPath, 'documentos.sqlite');
const jsonPath = path.join(userDataPath, 'documentos.json');

// Asegurar que el directorio exista
if (!fs.existsSync(userDataPath)) {
  fs.mkdirSync(userDataPath, { recursive: true });
  console.log('Directorio de datos del usuario creado en:', userDataPath);
}

let db = null;
let saveTimer = null;
const SAVE_DELAY = 2000; // 2 segundos de debounce para escrituras en lote

// ═══════════════ FUNCIONES INTERNAS ═══════════════

// Guardar base de datos a disco
function guardarDB() {
  if (!db) return;
  try {
    const data = db.export();
    fs.writeFileSync(sqlitePath, Buffer.from(data));
  } catch (err) {
    console.error('Error al guardar la base de datos:', err);
  }
}

// Guardado con debounce (para operaciones en lote como indexación)
function guardarDBDebounced() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(guardarDB, SAVE_DELAY);
}

// Sanitizar consulta para FTS4 (eliminar operadores especiales)
function sanitizeFTSQuery(query) {
  return query.trim()
    .replace(/["*(){}[\]^~:-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 0)
    .join(' ');
}

// Migrar datos desde LowDB (JSON) si existen
function migrarDesdeLowDB() {
  if (!fs.existsSync(jsonPath)) return;

  try {
    // Verificar si ya hay datos en SQLite
    const countResult = db.exec('SELECT COUNT(*) FROM documentos');
    const count = countResult[0]?.values[0]?.[0] || 0;
    if (count > 0) {
      console.log('La base de datos SQLite ya tiene datos, saltando migración');
      return;
    }

    const jsonData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    const documentos = jsonData.documentos || [];

    if (documentos.length === 0) return;

    console.log(`Migrando ${documentos.length} documentos desde LowDB a SQLite...`);

    // Usar transacción para velocidad
    db.run('BEGIN TRANSACTION');

    for (const doc of documentos) {
      db.run(
        'INSERT OR IGNORE INTO documentos (nombre, ruta, tipo, fecha, asunto, contenido, fecha_indexacion) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          doc.nombre || '',
          doc.ruta || '',
          doc.tipo || '',
          doc.fecha || '',
          doc.asunto || '',
          doc.contenido || '',
          doc.fecha_indexacion || new Date().toISOString()
        ]
      );
    }

    db.run('COMMIT');
    guardarDB();

    console.log(`Migración completada: ${documentos.length} documentos importados a SQLite`);

    // Renombrar archivo JSON original como backup
    const backupPath = jsonPath + '.bak';
    if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
    fs.renameSync(jsonPath, backupPath);
    console.log('Archivo JSON original renombrado a .bak');

  } catch (err) {
    try { db.run('ROLLBACK'); } catch (_) {}
    console.error('Error durante la migración desde LowDB:', err);
  }
}

// Reconstruir índice FTS si está desincronizado
function reconstruirFTSSiNecesario() {
  try {
    const mainCount = db.exec('SELECT COUNT(*) FROM documentos');
    const ftsCount = db.exec('SELECT COUNT(*) FROM documentos_fts');
    const numMain = mainCount[0]?.values[0]?.[0] || 0;
    const numFts = ftsCount[0]?.values[0]?.[0] || 0;

    if (numMain > 0 && numFts === 0) {
      console.log(`Reconstruyendo índice FTS para ${numMain} documentos...`);
      db.run('INSERT INTO documentos_fts(docid, nombre, asunto, contenido) SELECT id, nombre, asunto, contenido FROM documentos');
      guardarDB();
      console.log('Índice FTS reconstruido correctamente');
    }
  } catch (err) {
    console.error('Error al reconstruir FTS:', err);
  }
}

// ═══════════════ API PÚBLICA ═══════════════

module.exports = {
  // Inicializar la base de datos (llamar antes de cualquier operación)
  inicializar: async () => {
    const SQL = await initSqlJs();

    // Cargar base de datos existente o crear nueva
    if (fs.existsSync(sqlitePath)) {
      const buffer = fs.readFileSync(sqlitePath);
      db = new SQL.Database(buffer);
      console.log('Base de datos SQLite cargada desde disco');
    } else {
      db = new SQL.Database();
      console.log('Nueva base de datos SQLite creada');
    }

    // Crear tabla principal
    db.run(`
      CREATE TABLE IF NOT EXISTS documentos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL DEFAULT '',
        ruta TEXT UNIQUE NOT NULL,
        tipo TEXT DEFAULT '',
        fecha TEXT DEFAULT '',
        asunto TEXT DEFAULT '',
        contenido TEXT DEFAULT '',
        fecha_indexacion TEXT DEFAULT ''
      )
    `);

    // Crear índice en ruta para búsquedas rápidas de existencia
    db.run('CREATE INDEX IF NOT EXISTS idx_documentos_ruta ON documentos(ruta)');

    // Crear tabla FTS4 para búsqueda de texto completo (unicode61 para español)
    db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS documentos_fts USING fts4(
        nombre, asunto, contenido,
        tokenize=unicode61
      )
    `);

    // Triggers para mantener el índice FTS sincronizado
    db.run(`
      CREATE TRIGGER IF NOT EXISTS doc_fts_insert AFTER INSERT ON documentos BEGIN
        INSERT INTO documentos_fts(docid, nombre, asunto, contenido)
        VALUES(new.id, new.nombre, new.asunto, new.contenido);
      END
    `);

    db.run(`
      CREATE TRIGGER IF NOT EXISTS doc_fts_delete AFTER DELETE ON documentos BEGIN
        DELETE FROM documentos_fts WHERE docid = old.id;
      END
    `);

    db.run(`
      CREATE TRIGGER IF NOT EXISTS doc_fts_update AFTER UPDATE ON documentos BEGIN
        DELETE FROM documentos_fts WHERE docid = old.id;
        INSERT INTO documentos_fts(docid, nombre, asunto, contenido)
        VALUES(new.id, new.nombre, new.asunto, new.contenido);
      END
    `);

    // Migrar datos existentes desde LowDB si hay
    migrarDesdeLowDB();

    // Verificar que FTS esté sincronizado
    reconstruirFTSSiNecesario();

    console.log('Base de datos SQLite + FTS4 inicializada correctamente');
    return true;
  },

  // Agregar un documento a la base de datos
  agregarDocumento: (documento) => {
    return new Promise((resolve, reject) => {
      try {
        db.run(
          'INSERT OR IGNORE INTO documentos (nombre, ruta, tipo, fecha, asunto, contenido, fecha_indexacion) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [
            documento.nombre || '',
            documento.ruta || '',
            documento.tipo || '',
            documento.fecha || '',
            documento.asunto || '',
            documento.contenido || '',
            new Date().toISOString()
          ]
        );

        const result = db.exec('SELECT last_insert_rowid()');
        const id = result[0]?.values[0]?.[0] || 0;

        guardarDBDebounced();
        resolve({ id });
      } catch (err) {
        reject(err);
      }
    });
  },

  // Buscar documentos según criterios (usa FTS4 para búsqueda de texto)
  // Soporta paginación: criterios.page (1-based), criterios.pageSize (default 50)
  buscarDocumentos: (criterios) => {
    return new Promise((resolve, reject) => {
      try {
        const hasKeyword = criterios.keyword && criterios.keyword.trim() !== '';
        let sql;
        let params = [];

        if (hasKeyword) {
          const ftsQuery = sanitizeFTSQuery(criterios.keyword);
          if (ftsQuery.length > 0) {
            // Búsqueda FTS4: usa el índice de texto completo
            sql = `SELECT d.* FROM documentos d
                   WHERE d.id IN (SELECT docid FROM documentos_fts WHERE documentos_fts MATCH ?)`;
            params.push(ftsQuery);
          } else {
            sql = 'SELECT * FROM documentos d WHERE 1=1';
          }
        } else {
          sql = 'SELECT * FROM documentos d WHERE 1=1';
        }

        // Filtrar por fecha desde
        if (criterios.dateFrom && criterios.dateFrom.trim() !== '') {
          sql += ' AND d.fecha >= ?';
          params.push(criterios.dateFrom);
        }

        // Filtrar por fecha hasta
        if (criterios.dateTo && criterios.dateTo.trim() !== '') {
          sql += ' AND d.fecha <= ?';
          params.push(criterios.dateTo);
        }

        // Filtrar por tipo de documento
        if (criterios.documentType && criterios.documentType.trim() !== '') {
          sql += ' AND d.tipo = ?';
          params.push(criterios.documentType);
        }

        // Contar total de resultados (para paginación)
        const countSql = sql.replace(/^SELECT d\.\*|^SELECT \*/, 'SELECT COUNT(*) as total');
        const countStmt = db.prepare(countSql);
        if (params.length > 0) countStmt.bind(params);
        countStmt.step();
        const total = countStmt.getAsObject().total;
        countStmt.free();

        // Añadir ordenación y paginación
        sql += ' ORDER BY d.fecha_indexacion DESC';

        const page = Math.max(1, parseInt(criterios.page) || 1);
        const pageSize = Math.max(1, Math.min(200, parseInt(criterios.pageSize) || 50));
        const offset = (page - 1) * pageSize;

        sql += ' LIMIT ? OFFSET ?';
        params.push(pageSize, offset);

        // Ejecutar con prepared statement
        const stmt = db.prepare(sql);
        if (params.length > 0) stmt.bind(params);

        const resultados = [];
        while (stmt.step()) {
          resultados.push(stmt.getAsObject());
        }
        stmt.free();

        resolve({
          resultados,
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize)
        });
      } catch (err) {
        console.error('Error en búsqueda:', err);
        resolve({ resultados: [], total: 0, page: 1, pageSize: 50, totalPages: 0 });
      }
    });
  },

  // Verificar si un documento ya existe en la base de datos
  documentoExiste: (ruta) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare('SELECT 1 FROM documentos WHERE ruta = ? LIMIT 1');
        stmt.bind([ruta]);
        const existe = stmt.step();
        stmt.free();
        resolve(existe);
      } catch (err) {
        reject(err);
      }
    });
  },

  // Actualizar el asunto de un documento
  actualizarAsuntoDocumento: (ruta, nuevoAsunto) => {
    return new Promise((resolve, reject) => {
      try {
        console.log(`Actualizando asunto para documento: ${ruta}`);
        db.run('UPDATE documentos SET asunto = ? WHERE ruta = ?', [nuevoAsunto, ruta]);
        const changes = db.getRowsModified();

        if (changes === 0) {
          console.warn('No se encontró el documento para actualizar');
          reject(new Error('Documento no encontrado'));
          return;
        }

        guardarDB(); // Guardado inmediato para ediciones individuales
        console.log('Asunto actualizado correctamente');
        resolve({
          success: true,
          cambios: changes,
          mensaje: 'Asunto actualizado correctamente'
        });
      } catch (err) {
        console.error('Error al actualizar asunto:', err);
        reject(err);
      }
    });
  },

  // Forzar guardado inmediato a disco (llamar después de indexación masiva)
  forzarGuardado: () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    guardarDB();
  },

  // Cerrar la base de datos (fuerza guardado y libera recursos)
  cerrar: () => {
    return new Promise((resolve) => {
      try {
        if (saveTimer) {
          clearTimeout(saveTimer);
          saveTimer = null;
        }
        guardarDB();
        if (db) {
          db.close();
          db = null;
        }
        console.log('Base de datos SQLite cerrada correctamente');
      } catch (err) {
        console.error('Error al cerrar base de datos:', err);
      }
      resolve();
    });
  }
};