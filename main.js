const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const database = require('./src/db/database');
const pdfParser = require('./src/utils/pdf-parser');
const wordParser = require('./src/utils/word-parser');
const excelParser = require('./src/utils/excel-parser');
const { detectarAsunto, determinarTipoDocumento } = require('./src/utils/doc-utils');

const driveApi = require('./src/drive/api');
const ocrService = require('./src/ocr/ocr-service');

// --- ENTERPRISE CONFIG ---
const ENTERPRISE_CONFIG_PATH = require('path').join(
  require('os').homedir(),
  'AppData', 'Roaming', 'Krawl-Enterprise', 'config.json'
);

let enterpriseConfig = null;
let enterpriseConnected = false;

function leerConfigEnterprise() {
  try {
    if (!fs.existsSync(ENTERPRISE_CONFIG_PATH)) return null;
    const raw = fs.readFileSync(ENTERPRISE_CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.error('Error leyendo config enterprise:', e.message);
    return null;
  }
}

function guardarConfigEnterprise(config) {
  try {
    const dir = require('path').dirname(ENTERPRISE_CONFIG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(ENTERPRISE_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  } catch (e) {
    console.error('Error guardando config enterprise:', e.message);
    throw e;
  }
}
// -------------------------

// VARIABLES GLOBALES PARA CONTROL DE INDEXACIÃ“N
let indexacionEnProgreso = false;
let indexacionPausada = false;
let indexacionCancelada = false;

// AÃ±adir manejo de errores global - escribir log en disco para diagnÃ³stico
const logFile = path.join(app.getPath('userData'), 'krawl-error.log');
process.on('uncaughtException', (error) => {
  const msg = `[${new Date().toISOString()}] Error no capturado: ${error.stack || error}\n`;
  try { fs.appendFileSync(logFile, msg); } catch(e) {}
  console.error('Error no capturado:', error);
});

process.on('unhandledRejection', (reason) => {
  const msg = `[${new Date().toISOString()}] Promise rechazada: ${reason?.stack || reason}\n`;
  try { fs.appendFileSync(logFile, msg); } catch(e) {}
  console.error('Promise rechazada:', reason);
});

// Crear carpeta para datos de la app en AppData (no en Program Files)
const dataDir = app.getPath('userData');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log('Directorio de datos creado en:', dataDir);
}

// Variables para la detecciÃ³n automÃ¡tica de documentos
let ultimaVerificacion = new Date();
const INTERVALO_VERIFICACION = 300000; // 5 minutos en milisegundos
let verificacionAutomaticaActiva = true;
let timerVerificacion = null;

// Mantener referencia global
let mainWindow;

// FunciÃ³n auxiliar para verificar si un archivo es vÃ¡lido (PDF o Word)
function esArchivoValido(rutaArchivo) {
  const extension = path.extname(rutaArchivo).toLowerCase();
  return ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.jpg', '.jpeg', '.png'].includes(extension);
}

// FunciÃ³n auxiliar para procesar un documento (PDF, Word, Excel, Imagen)
async function procesarArchivo(rutaArchivo) {
  const extension = path.extname(rutaArchivo).toLowerCase();

  try {
    if (extension === '.pdf') {
      console.log(`Procesando PDF: ${rutaArchivo}`);
      const info = await pdfParser.extraerTextoPDF(rutaArchivo);

      // Si el texto es muy corto (probablemente escaneado), intentar OCR
      if (!info.texto || info.texto.trim().length < 100) {
        console.log(`Texto PDF insuficiente. Intentando OCR...`);
        const ocrResult = await ocrService.processarOCR(rutaArchivo);
        if (ocrResult && ocrResult.text && ocrResult.text.length > 0) {
          info.texto = ocrResult.text;

          // Usar mÃ³dulo centralizado de detecciÃ³n de asunto
          info.asunto = detectarAsunto(ocrResult.text) || 'Documento Escaneado (OCR)';
        }
      }
      return info;

    } else if (['.doc', '.docx'].includes(extension)) {
      console.log(`Procesando Word: ${rutaArchivo}`);
      return await wordParser.extraerTextoWord(rutaArchivo);
    } else if (['.xls', '.xlsx'].includes(extension)) {
      console.log(`Procesando Excel: ${rutaArchivo}`);
      return await excelParser.extraerTextoExcel(rutaArchivo);
    } else if (['.jpg', '.jpeg', '.png'].includes(extension)) {
      console.log(`Procesando Imagen: ${rutaArchivo}`);
      const ocrResult = await ocrService.processarOCR(rutaArchivo);
      let asuntoImg = 'Imagen Escaneada';
      if (ocrResult.text) {
        asuntoImg = detectarAsunto(ocrResult.text) || ocrResult.text.substring(0, 50) + '...';
      }

      return {
        texto: ocrResult.text || '',
        asunto: asuntoImg,
        metadatos: { tipo: 'imagen', original: extension }
      };
    } else {
      throw new Error(`Tipo de archivo no soportado: ${extension}`);
    }

  } catch (error) {
    console.error(`Error al procesar archivo ${rutaArchivo}: ${error.message}`);
    return {
      texto: '',
      asunto: 'Error al procesar',
      error: error.message
    };
  }
}

// Old processWithOCR (Python) replaced by ocrService (tesseract.js + mupdf WASM)




function createWindow() {
  console.log('Creando ventana principal...');

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      devTools: !app.isPackaged // DevTools solo en desarrollo
    }
  });

  // Verificar que el archivo HTML exista
  const htmlPath = path.join(__dirname, 'renderer', 'index.html');
  console.log('Ruta al archivo HTML:', htmlPath);

  if (fs.existsSync(htmlPath)) {
    console.log('El archivo HTML existe, cargando...');
    // Cargar la interfaz HTML
    mainWindow.loadFile(htmlPath);
  } else {
    console.error('ERROR: El archivo HTML no existe en la ruta:', htmlPath);
    console.log('Directorio actual:', __dirname);
    console.log('Contenido de la carpeta renderer:');

    try {
      const rendererDir = path.join(__dirname, 'renderer');
      if (fs.existsSync(rendererDir)) {
        console.log(fs.readdirSync(rendererDir));
      } else {
        console.error('La carpeta renderer no existe');
      }
    } catch (err) {
      console.error('Error al listar directorio:', err);
    }
  }

  // Abrir DevTools solo en desarrollo
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }

  // Detectar errores al cargar la pÃ¡gina
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Error al cargar la pÃ¡gina:', errorCode, errorDescription);
  });

  // Confirmar cuando la pÃ¡gina se ha cargado correctamente
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('PÃ¡gina cargada correctamente');

    // Enviar estado enterprise al renderer
    if (!enterpriseConfig || !enterpriseConfig.dbPath) {
      mainWindow.webContents.send('enterprise-config-needed', {});
    } else if (!enterpriseConnected) {
      mainWindow.webContents.send('enterprise-db-status', {
        connected: false,
        error: 'Ruta no accesible: ' + enterpriseConfig.dbPath
      });
    } else {
      mainWindow.webContents.send('enterprise-db-status', {
        connected: true,
        path: enterpriseConfig.dbPath
      });
    }
  });

  // Detectar cuando la ventana se cierre
  mainWindow.on('closed', () => {
    mainWindow = null;
    console.log('Ventana cerrada');
  });
}

// FunciÃ³n para verificar documentos nuevos (ACTUALIZADA para incluir Word)
async function verificarDocumentosNuevos() {
  try {
    console.log('Iniciando verificaciÃ³n de documentos nuevos...');

    // Obtener lista actual de documentos desde el drive/sistema de archivos
    const documentosActuales = await driveApi.listarTodosLosDocumentos();
    console.log(`Se encontraron ${documentosActuales.length} documentos en total.`);

    // Filtrar para encontrar solo documentos nuevos (PDF y Word)
    const documentosNuevos = [];

    for (const doc of documentosActuales) {
      try {
        // Verificar si ya existe en la base de datos
        const existe = await database.documentoExiste(doc.ruta);
        if (!existe && esArchivoValido(doc.ruta)) {
          console.log(`Documento nuevo encontrado: ${doc.nombre}`);
          documentosNuevos.push(doc);
        }
      } catch (error) {
        console.error(`Error al verificar si existe el documento ${doc.nombre}:`, error);
      }
    }

    // Actualizar la Ãºltima verificaciÃ³n
    ultimaVerificacion = new Date();

    // Si se encontraron documentos nuevos, notificar al frontend
    if (documentosNuevos.length > 0) {
      console.log(`Se encontraron ${documentosNuevos.length} documentos nuevos.`);

      // Verificar que mainWindow existe antes de enviar el mensaje
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('documentos-nuevos-detectados', documentosNuevos);
      } else {
        console.log('La ventana principal no estÃ¡ disponible para notificar.');
      }
    } else {
      console.log('No se encontraron documentos nuevos.');
    }

    return documentosNuevos;
  } catch (error) {
    console.error('Error durante la verificaciÃ³n de documentos nuevos:', error);
    return [];
  }
}

// FunciÃ³n para procesar un documento nuevo con asunto personalizado (ACTUALIZADA)
async function procesarDocumentoNuevo(documento, asuntoPersonalizado) {
  try {
    console.log(`Procesando documento nuevo con asunto personalizado: ${documento.nombre}`);

    // Extraer texto del documento (PDF o Word)
    let documentoInfo;
    try {
      const infoPromise = procesarArchivo(documento.ruta);
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Tiempo lÃ­mite excedido al procesar documento')), 120000);
      });

      documentoInfo = await Promise.race([infoPromise, timeoutPromise]);
    } catch (docError) {
      console.error(`Error o tiempo lÃ­mite al procesar documento ${documento.nombre}: ${docError.message}`);
      documentoInfo = { texto: '', asunto: 'Error al procesar' };
    }

    // Guardar en la base de datos con el asunto personalizado
    await database.agregarDocumento({
      nombre: documento.nombre,
      ruta: documento.ruta,
      tipo: documento.tipo,
      fecha: documento.fecha,
      asunto: asuntoPersonalizado || documentoInfo.asunto || 'Sin asunto',
      contenido: documentoInfo.texto || ''
    });

    console.log(`Documento procesado y guardado correctamente: ${documento.nombre}`);
    return { success: true };
  } catch (error) {
    console.error(`Error al procesar documento ${documento.nombre}:`, error);
    return { success: false, error: error.message };
  }
}

// FUNCIÃ“N PARA INDEXAR CARPETA ESPECÃFICA (ACTUALIZADA para incluir Word)
async function indexarCarpetaEspecifica(rutaCarpeta) {
  try {
    console.log(`Iniciando indexaciÃ³n de carpeta especÃ­fica: ${rutaCarpeta}`);

    // Verificar que la carpeta existe
    if (!fs.existsSync(rutaCarpeta)) {
      throw new Error('La carpeta especificada no existe');
    }

    // FunciÃ³n recursiva para obtener todos los archivos vÃ¡lidos de una carpeta
    function obtenerArchivosValidos(directorio) {
      const archivos = [];

      try {
        const elementos = fs.readdirSync(directorio);

        for (const elemento of elementos) {
          const rutaCompleta = path.join(directorio, elemento);
          const stats = fs.statSync(rutaCompleta);

          if (stats.isDirectory()) {
            // Si es un directorio, procesar recursivamente
            archivos.push(...obtenerArchivosValidos(rutaCompleta));
          } else if (stats.isFile() && esArchivoValido(rutaCompleta)) {
            // Si es un archivo vÃ¡lido (PDF o Word), agregarlo a la lista
            const extension = path.extname(rutaCompleta).toLowerCase();
            console.log(`Encontrado archivo ${extension.toUpperCase()}: ${elemento}`);

            archivos.push({
              nombre: elemento,
              ruta: rutaCompleta,
              tipo: determinarTipoDocumento(elemento),
              fecha: stats.mtime.toISOString().split('T')[0],
              extension: extension
            });
          }
        }
      } catch (error) {
        console.error(`Error al leer directorio ${directorio}:`, error);
      }

      return archivos;
    }

    // FunciÃ³n auxiliar para determinar el tipo de documento
    // (usa funciÃ³n centralizada de doc-utils)

    // Obtener todos los archivos vÃ¡lidos de la carpeta
    const documentos = obtenerArchivosValidos(rutaCarpeta);
    console.log(`Se encontraron ${documentos.length} documentos vÃ¡lidos en la carpeta.`);

    let indexados = 0;
    let errores = 0;
    let yaExisten = 0;

    // Procesar cada documento
    for (const doc of documentos) {
      try {
        // Verificar si ya existe en la base de datos
        const existe = await database.documentoExiste(doc.ruta);
        if (existe) {
          console.log(`El documento ya existe en la base de datos: ${doc.nombre}`);
          yaExisten++;
          continue;
        }

        // Extraer texto y asunto del documento
        console.log(`Procesando documento ${doc.extension.toUpperCase()}: ${doc.nombre}`);

        const infoPromise = procesarArchivo(doc.ruta);
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Tiempo lÃ­mite excedido al procesar documento')), 120000);
        });

        let documentoInfo;
        try {
          documentoInfo = await Promise.race([infoPromise, timeoutPromise]);
        } catch (docError) {
          console.error(`Error o tiempo lÃ­mite al procesar documento ${doc.nombre}: ${docError.message}`);
          documentoInfo = { texto: '', asunto: 'Error al procesar' };
        }

        // Guardar en la base de datos
        await database.agregarDocumento({
          nombre: doc.nombre,
          ruta: doc.ruta,
          tipo: doc.tipo,
          fecha: doc.fecha,
          asunto: documentoInfo.asunto || 'Sin asunto',
          contenido: documentoInfo.texto || ''
        });

        indexados++;

        // Informar progreso cada 5 documentos
        if (indexados % 5 === 0) {
          console.log(`Progreso: ${indexados} documentos indexados hasta ahora...`);
        }

      } catch (docError) {
        console.error(`Error al procesar documento ${doc.nombre}:`, docError);
        errores++;
      }
    }
    const mensaje = `IndexaciÃ³n de carpeta completada. ${indexados} documentos nuevos indexados. ${yaExisten} ya existÃ­an. ${errores} errores.`;
    console.log(mensaje);
    return {
      success: true,
      message: mensaje,
      documentosIndexados: indexados,
      documentosExistentes: yaExisten,
      errores: errores,
      total: documentos.length
    };
  } catch (error) {
    console.error('Error durante la indexaciÃ³n de carpeta especÃ­fica:', error);
    return { success: false, error: error.message };
  }
}

// FunciÃ³n auxiliar para formatear tiempo en MM:SS
function formatearTiempo(segundos) {
  const minutos = Math.floor(segundos / 60);
  const segs = segundos % 60;
  return `${minutos.toString().padStart(2, '0')}:${segs.toString().padStart(2, '0')}`;
}

// FunciÃ³n centralizada para procesar una lista de documentos con progreso
async function procesarListaDeDocumentos(documentos) {
  // Caso especial: no hay documentos
  if (!documentos || documentos.length === 0) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('indexacion-progreso', {
        tipo: 'sin-documentos',
        message: 'No se encontraron documentos vÃ¡lidos para indexar'
      });
    }
    return {
      success: true,
      message: 'No se encontraron documentos vÃ¡lidos',
      documentosIndexados: 0,
      documentosExistentes: 0,
      errores: 0,
      total: 0
    };
  }

  // Enviar informaciÃ³n inicial al frontend
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('indexacion-progreso', {
      tipo: 'inicio',
      total: documentos.length,
      processed: 0,
      success: 0,
      errors: 0,
      existing: 0,
      currentFile: 'Analizando documentos...'
    });
  }

  let indexados = 0;
  let exitosos = 0;
  let errores = 0;
  let yaExisten = 0;
  const tiempoInicio = Date.now();

  // Para cÃ¡lculo de tiempo mÃ¡s preciso (solo considera tiempo de procesamiento real)
  let tiempoProcesamientoTotal = 0;
  let documentosProcesadosReal = 0; // Solo los que realmente se procesan (no existentes)

  // Procesar cada documento
  for (let i = 0; i < documentos.length; i++) {
    const doc = documentos[i];

    // VERIFICAR CONTROL DE PAUSA
    while (indexacionPausada && !indexacionCancelada) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // VERIFICAR CONTROL DE CANCELACIÃ“N
    if (indexacionCancelada) {
      console.log('IndexaciÃ³n cancelada por el usuario');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('indexacion-progreso', {
          tipo: 'cancelado',
          total: documentos.length,
          processed: indexados,
          success: exitosos,
          errors: errores,
          existing: yaExisten,
          currentFile: 'Cancelado por el usuario',
          elapsedTime: formatearTiempo(Math.floor((Date.now() - tiempoInicio) / 1000)),
          estimatedTime: '--:--'
        });
      }
      break;
    }

    try {
      // Calcular tiempo transcurrido
      const tiempoTranscurrido = Math.floor((Date.now() - tiempoInicio) / 1000);

      // Calcular tiempo estimado basado en el promedio de procesamiento real
      let tiempoEstimadoStr = 'Calculando...';
      if (documentosProcesadosReal > 0) {
        const promedioMs = tiempoProcesamientoTotal / documentosProcesadosReal;
        // Estimar cuÃ¡ntos documentos nuevos quedan (asumiendo misma proporciÃ³n)
        const proporcionNuevos = documentosProcesadosReal / (indexados || 1);
        const restantes = documentos.length - indexados;
        const estimadosNuevos = Math.ceil(restantes * proporcionNuevos);
        const tiempoRestante = Math.floor((promedioMs * estimadosNuevos) / 1000);
        tiempoEstimadoStr = formatearTiempo(tiempoRestante);
      } else if (indexados > 0 && yaExisten === indexados) {
        // Todos los procesados hasta ahora ya existÃ­an
        tiempoEstimadoStr = '< 00:01';
      }

      // Enviar progreso actual al frontend
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('indexacion-progreso', {
          tipo: 'progreso',
          total: documentos.length,
          processed: indexados,
          success: exitosos,
          errors: errores,
          existing: yaExisten,
          currentFile: doc.nombre,
          elapsedTime: formatearTiempo(tiempoTranscurrido),
          estimatedTime: tiempoEstimadoStr,
          percentage: Math.round(((indexados + 1) / documentos.length) * 100)
        });
      }

      // Verificar si ya existe en la base de datos
      const existe = await database.documentoExiste(doc.ruta);
      if (existe) {
        console.log(`El documento ya existe: ${doc.nombre}`);
        yaExisten++;
        indexados++;

        // Notificar que se saltÃ³ un archivo existente
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('indexacion-progreso', {
            tipo: 'existente',
            archivo: doc.nombre,
            processed: indexados,
            existing: yaExisten
          });
        }
        continue;
      }

      // Procesar el documento - medir tiempo
      console.log(`Procesando ${doc.extension.toUpperCase()}: ${doc.nombre}`);
      const inicioProc = Date.now();

      const infoPromise = procesarArchivo(doc.ruta);
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Tiempo lÃ­mite excedido (2 min)')), 120000);
      });

      let documentoInfo;
      try {
        documentoInfo = await Promise.race([infoPromise, timeoutPromise]);

        // Guardar en la base de datos
        await database.agregarDocumento({
          nombre: doc.nombre,
          ruta: doc.ruta,
          tipo: doc.tipo,
          fecha: doc.fecha,
          asunto: documentoInfo.asunto || 'Sin asunto',
          contenido: documentoInfo.texto || ''
        });

        exitosos++;

        // Actualizar mÃ©tricas de tiempo
        tiempoProcesamientoTotal += (Date.now() - inicioProc);
        documentosProcesadosReal++;

      } catch (docError) {
        console.error(`Error al procesar ${doc.nombre}: ${docError.message}`);
        errores++;

        // Enviar error especÃ­fico al frontend
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('indexacion-progreso', {
            tipo: 'error',
            archivo: doc.nombre,
            error: docError.message
          });
        }
      }

      indexados++;

    } catch (generalError) {
      console.error(`Error general al procesar ${doc.nombre}:`, generalError);
      errores++;
      indexados++;
    }
  }

  // Finalizar indexaciÃ³n
  indexacionEnProgreso = false;
  indexacionPausada = false;

  const tiempoTotal = Math.floor((Date.now() - tiempoInicio) / 1000);

  // Determinar tipo de finalizaciÃ³n
  if (!indexacionCancelada) {
    let tipoFinal = 'completado';
    let mensajeFinal = 'IndexaciÃ³n completada';

    // Caso especial: todos los archivos ya existÃ­an
    if (yaExisten === documentos.length && exitosos === 0 && errores === 0) {
      tipoFinal = 'todos-existentes';
      mensajeFinal = 'Todos los archivos ya estaban indexados';
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('indexacion-progreso', {
        tipo: tipoFinal,
        total: documentos.length,
        processed: indexados,
        success: exitosos,
        errors: errores,
        existing: yaExisten,
        currentFile: mensajeFinal,
        elapsedTime: formatearTiempo(tiempoTotal),
        estimatedTime: 'Finalizado',
        percentage: 100
      });
    }
  }

  // Generar mensaje de resumen
  let mensaje;
  if (indexacionCancelada) {
    mensaje = `Cancelado: ${exitosos} procesados, ${yaExisten} existÃ­an, ${errores} errores`;
  } else if (yaExisten === documentos.length && exitosos === 0) {
    mensaje = `Todos los ${yaExisten} archivos ya estaban indexados`;
  } else {
    mensaje = `Completado: ${exitosos} nuevos, ${yaExisten} existÃ­an, ${errores} errores`;
  }
  console.log(mensaje);

  // Forzar guardado a disco despuÃ©s de indexaciÃ³n masiva
  database.forzarGuardado();

  // Resetear flag de cancelaciÃ³n para prÃ³xima ejecuciÃ³n
  indexacionCancelada = false;

  return {
    success: true,
    message: mensaje,
    documentosIndexados: exitosos,
    documentosExistentes: yaExisten,
    errores: errores,
    total: documentos.length,
    todosExistentes: yaExisten === documentos.length && exitosos === 0
  };
}

// NUEVA FUNCIÃ“N DE INDEXACIÃ“N CON PROGRESO EN TIEMPO REAL
async function indexarCarpetaEspecificaConProgreso(rutaCarpeta, filtros = {}) {
  try {
    console.log(`Iniciando indexaciÃ³n con progreso en tiempo real: ${rutaCarpeta}`);

    // Inicializar variables de control
    indexacionEnProgreso = true;
    indexacionPausada = false;
    indexacionCancelada = false;

    // Verificar que la carpeta existe
    if (!fs.existsSync(rutaCarpeta)) {
      throw new Error('La carpeta especificada no existe');
    }

    // FunciÃ³n recursiva para obtener todos los archivos vÃ¡lidos
    function obtenerArchivosValidos(directorio) {
      const archivos = [];

      try {
        const elementos = fs.readdirSync(directorio);

        for (const elemento of elementos) {
          const rutaCompleta = path.join(directorio, elemento);
          const stats = fs.statSync(rutaCompleta);

          if (stats.isDirectory()) {
            archivos.push(...obtenerArchivosValidos(rutaCompleta));
          } else if (stats.isFile() && esArchivoValido(rutaCompleta)) {
            const extension = path.extname(rutaCompleta).toLowerCase();

            // Aplicar filtros
            let cumpleFiltros = true;
            if (filtros) {
                if (filtros.type && filtros.type !== 'all') {
                    if (filtros.type === 'pdf' && extension !== '.pdf') cumpleFiltros = false;
                    if (filtros.type === 'word' && !['.doc', '.docx'].includes(extension)) cumpleFiltros = false;
                    if (filtros.type === 'excel' && !['.xls', '.xlsx'].includes(extension)) cumpleFiltros = false;
                    if (filtros.type === 'image' && !['.jpg', '.jpeg', '.png'].includes(extension)) cumpleFiltros = false;
                }
                const fechaArchivo = stats.mtime.toISOString().split('T')[0];
                if (filtros.dateFrom && fechaArchivo < filtros.dateFrom) cumpleFiltros = false;
                if (filtros.dateTo && fechaArchivo > filtros.dateTo) cumpleFiltros = false;
            }

            if (cumpleFiltros) {
              archivos.push({
                nombre: elemento,
                ruta: rutaCompleta,
                tipo: determinarTipoDocumento(elemento),
                fecha: stats.mtime.toISOString().split('T')[0],
                extension: extension
              });
            }
          }
        }
      } catch (error) {
        console.error(`Error al leer directorio ${directorio}:`, error);
      }

      return archivos;
    }

    // Obtener todos los archivos vÃ¡lidos
    const documentos = obtenerArchivosValidos(rutaCarpeta);
    console.log(`Se encontraron ${documentos.length} documentos vÃ¡lidos.`);

    return await procesarListaDeDocumentos(documentos);

  } catch (error) {
    console.error('Error durante la indexaciÃ³n:', error);

    // Resetear variables de control en caso de error
    indexacionEnProgreso = false;
    indexacionPausada = false;
    indexacionCancelada = false;

    // Enviar error al frontend
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('indexacion-progreso', {
        tipo: 'error-general',
        error: error.message
      });
    }

    return { success: false, error: error.message };
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• AUTO-ACTUALIZACIONES â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function configurarAutoUpdater() {
  if (!app.isPackaged) {
    console.log('Auto-updater desactivado en modo desarrollo');
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('Buscando actualizaciones...');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('ActualizaciÃ³n disponible:', info.version);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-available', {
        version: info.version,
        releaseNotes: info.releaseNotes || ''
      });
    }
  });

  autoUpdater.on('update-not-available', () => {
    console.log('No hay actualizaciones disponibles');
  });

  autoUpdater.on('download-progress', (progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-download-progress', {
        percent: Math.round(progress.percent),
        transferred: progress.transferred,
        total: progress.total
      });
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('ActualizaciÃ³n descargada:', info.version);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-downloaded', {
        version: info.version
      });
    }
  });

  autoUpdater.on('error', (err) => {
    console.error('Error en auto-updater:', err.message);
  });

  // Verificar actualizaciones al iniciar (despuÃ©s de 5 segundos)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(err => {
      console.error('Error al verificar actualizaciones:', err.message);
    });
  }, 5000);

  // Verificar cada 4 horas
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(err => {
      console.error('Error al verificar actualizaciones:', err.message);
    });
  }, 4 * 60 * 60 * 1000);
}

// IPC handlers para actualizaciones
ipcMain.handle('update-download', async () => {
  try {
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('update-install', () => {
  autoUpdater.quitAndInstall(false, true);
});

ipcMain.handle('update-check', async () => {
  try {
    const result = await autoUpdater.checkForUpdates();
    return { success: true, version: result?.updateInfo?.version || null };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// Iniciar aplicaciÃ³n cuando Electron estÃ© listo
app.whenReady().then(async () => {
  console.log('Electron estÃ¡ listo, inicializando base de datos...');

  // Leer config enterprise ANTES de inicializar la DB
  enterpriseConfig = leerConfigEnterprise();
  if (enterpriseConfig && enterpriseConfig.dbPath) {
    const rootDir = require('path').parse(enterpriseConfig.dbPath).root || require('path').dirname(enterpriseConfig.dbPath);
    const rootAccesible = fs.existsSync(rootDir);
    if (rootAccesible) {
      console.log('Config enterprise encontrada, usando DB compartida:', enterpriseConfig.dbPath);
      await database.inicializar(enterpriseConfig.dbPath);
      enterpriseConnected = true;
    } else {
      console.warn('Ruta enterprise no accesible (Drive no montado?), usando DB local de fallback:', enterpriseConfig.dbPath);
      enterpriseConnected = false;
      await database.inicializar();
    }
  } else {
    await database.inicializar();
  }
  console.log('Base de datos SQLite inicializada.');

  // Crear ventana PRIMERO para que sea visible de inmediato
  createWindow();

  // Configurar auto-actualizaciones (solo en producciÃ³n)
  configurarAutoUpdater();

  // Inicializar servicio OCR EN BACKGROUND (no bloquear la ventana)
  ocrService.inicializar().then(() => {
    console.log('Servicio OCR inicializado.');
  }).catch(err => {
    console.error('Error al inicializar OCR (continuando sin OCR):', err.message);
  });

  // Iniciar verificaciÃ³n automÃ¡tica de documentos nuevos
  if (verificacionAutomaticaActiva) {
    timerVerificacion = setInterval(() => {
      if (verificacionAutomaticaActiva) {
        verificarDocumentosNuevos().catch(err => {
          console.error('Error en la verificaciÃ³n automÃ¡tica:', err);
        });
      }
    }, INTERVALO_VERIFICACION);

    console.log(`VerificaciÃ³n automÃ¡tica iniciada. Intervalo: ${INTERVALO_VERIFICACION / 1000} segundos`);
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      console.log('Activando aplicaciÃ³n, creando nueva ventana...');
      createWindow();
    }
  });
}).catch(err => {
  console.error('Error al iniciar la aplicaciÃ³n:', err);
});

app.on('window-all-closed', async function () {
  console.log('Todas las ventanas cerradas');

  // Terminar worker OCR
  await ocrService.terminar();

  // Forzar guardado de la base de datos antes de salir
  database.forzarGuardado();

  // Detener el timer de verificaciÃ³n automÃ¡tica
  if (timerVerificacion) {
    clearInterval(timerVerificacion);
    timerVerificacion = null;
    console.log('VerificaciÃ³n automÃ¡tica detenida.');
  }

  if (process.platform !== 'darwin') {
    console.log('Cerrando la aplicaciÃ³n');
    app.quit();
  }
});

// Validar que una ruta sea un archivo de documento legÃ­timo (no ejecutable ni ruta sospechosa)
function esRutaSegura(ruta) {
  if (!ruta || typeof ruta !== 'string') return false;
  const normalized = path.resolve(ruta);
  const ext = path.extname(normalized).toLowerCase();
  const extensionesPermitidas = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.jpg', '.jpeg', '.png'];
  return extensionesPermitidas.includes(ext);
}

// Validar que un string sea seguro para usar como texto (sin longitud excesiva)
function esTextoSeguro(texto, maxLen = 500) {
  return typeof texto === 'string' && texto.length <= maxLen;
}

// Validar objeto de criterios de bÃºsqueda
function validarCriterios(criterios) {
  if (!criterios || typeof criterios !== 'object') return {};
  return {
    keyword: esTextoSeguro(criterios.keyword, 200) ? criterios.keyword : '',
    dateFrom: typeof criterios.dateFrom === 'string' ? criterios.dateFrom.slice(0, 10) : '',
    dateTo: typeof criterios.dateTo === 'string' ? criterios.dateTo.slice(0, 10) : '',
    documentType: typeof criterios.documentType === 'string' ? criterios.documentType.slice(0, 50) : '',
    sortOrder: criterios.sortOrder === 'asc' ? 'asc' : 'desc',
    page: parseInt(criterios.page) || 1,
    pageSize: parseInt(criterios.pageSize) || 50
  };
}

// Manejadores IPC existentes
ipcMain.handle('buscar-documentos', async (event, criterios) => {
  const criteriosValidados = validarCriterios(criterios);
  console.log('BÃºsqueda solicitada con criterios:', criteriosValidados);

  try {
    // Utilizar la base de datos para buscar documentos (con paginaciÃ³n)
    const resultado = await database.buscarDocumentos(criteriosValidados);
    console.log(`Se encontraron ${resultado.total} resultados (pÃ¡gina ${resultado.page}/${resultado.totalPages}).`);
    return resultado;
  } catch (error) {
    console.error('Error durante la bÃºsqueda:', error);
    return { resultados: [], total: 0, page: 1, pageSize: 50, totalPages: 0 };
  }
});

ipcMain.handle('abrir-documento', async (event, ruta) => {
  try {
    console.log('Intentando abrir documento:', ruta);
    // Validar que sea un tipo de archivo permitido
    if (!esRutaSegura(ruta)) {
      console.error('Ruta no permitida:', ruta);
      return { success: false, error: 'Tipo de archivo no permitido' };
    }
    // Verificar si el archivo existe
    if (fs.existsSync(ruta)) {
      console.log('El archivo existe, abriÃ©ndolo...');
      // Abrir el documento con la aplicaciÃ³n predeterminada
      await shell.openPath(ruta);
      return { success: true };
    } else {
      console.error('El archivo no existe en la ruta especificada');
      return { success: false, error: 'Archivo no encontrado' };
    }
  } catch (error) {
    console.error('Error al abrir el documento:', error);
    return { success: false, error: error.message };
  }
});

// INDEXAR CARPETA COMPLETA (ACTUALIZADA para incluir Word)
ipcMain.handle('indexar-carpeta', async (event) => {
  try {
    console.log('Iniciando indexaciÃ³n completa de documentos...');

    // Obtener lista de documentos desde el drive/sistema de archivos
    const documentos = await driveApi.listarTodosLosDocumentos();
    console.log(`Se encontraron ${documentos.length} documentos en total.`);

    let indexados = 0;
    let errores = 0;

    // Procesar cada documento vÃ¡lido
    for (const doc of documentos) {
      try {
        // Verificar si ya existe en la base de datos
        const existe = await database.documentoExiste(doc.ruta);
        if (existe) {
          console.log(`El documento ya existe en la base de datos: ${doc.nombre}`);
          continue;
        }

        // Verificar si es un archivo vÃ¡lido (PDF o Word)
        if (esArchivoValido(doc.ruta)) {
          // Extraer texto y asunto del documento
          console.log(`Procesando documento: ${doc.nombre}`);

          // Establecer un tiempo lÃ­mite para procesar cada documento
          const infoPromise = procesarArchivo(doc.ruta);
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Tiempo lÃ­mite excedido al procesar documento')), 120000);
          });

          let documentoInfo;
          try {
            documentoInfo = await Promise.race([infoPromise, timeoutPromise]);
          } catch (docError) {
            console.error(`Error o tiempo lÃ­mite al procesar documento ${doc.nombre}: ${docError.message}`);
            documentoInfo = { texto: '', asunto: 'Error al procesar' };
          }

          // Guardar en la base de datos
          await database.agregarDocumento({
            nombre: doc.nombre,
            ruta: doc.ruta,
            tipo: doc.tipo,
            fecha: doc.fecha,
            asunto: documentoInfo.asunto || 'Sin asunto',
            contenido: documentoInfo.texto || ''
          });

          indexados++;

          // Informar progreso cada 10 documentos
          if (indexados % 10 === 0) {
            console.log(`Progreso: ${indexados} documentos indexados hasta ahora...`);
          }
        }
      } catch (docError) {
        console.error(`Error al procesar documento ${doc.nombre}:`, docError);
        errores++;
      }
    }

    const mensaje = `IndexaciÃ³n completada. ${indexados} documentos indexados. ${errores} errores.`;
    console.log(mensaje);
    return { success: true, message: mensaje };
  } catch (error) {
    console.error('Error durante la indexaciÃ³n:', error);
    return { success: false, error: error.message };
  }
});

// NUEVOS MANEJADORES IPC PARA CAMPO DE RUTA

ipcMain.handle('seleccionar-carpeta', async (event) => {
  try {
    console.log('Abriendo diÃ¡logo de selecciÃ³n de carpeta...');

    const resultado = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Seleccionar carpeta para indexar',
      buttonLabel: 'Seleccionar'
    });

    if (resultado.canceled) {
      console.log('SelecciÃ³n de carpeta cancelada por el usuario');
      return { success: false, canceled: true };
    }

    const rutaSeleccionada = resultado.filePaths[0];
    console.log(`Carpeta seleccionada: ${rutaSeleccionada}`);

    return {
      success: true,
      path: rutaSeleccionada
    };
  } catch (error) {
    console.error('Error al mostrar diÃ¡logo de selecciÃ³n de carpeta:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('indexar-carpeta-especifica', async (event, { rutaCarpeta, filtros }) => {
  try {
    if (!rutaCarpeta || typeof rutaCarpeta !== 'string') {
      return { success: false, error: 'Ruta de carpeta invÃ¡lida' };
    }
    console.log(`Solicitud de indexaciÃ³n de carpeta especÃ­fica: ${rutaCarpeta}`);
    const resultado = await indexarCarpetaEspecificaConProgreso(rutaCarpeta, filtros);
    return resultado;
  } catch (error) {
    console.error('Error durante la indexaciÃ³n de carpeta especÃ­fica:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('sincronizar-drive', async (event) => {
  console.log('SincronizaciÃ³n con Google Drive solicitada');
  return { success: true, message: 'FunciÃ³n de sincronizaciÃ³n aÃºn no implementada' };
});

// Manejadores IPC para la detecciÃ³n de documentos nuevos
ipcMain.handle('verificar-documentos-nuevos', async (event) => {
  try {
    console.log('VerificaciÃ³n manual de documentos nuevos solicitada');
    const documentosNuevos = await verificarDocumentosNuevos();
    return {
      success: true,
      documentos: documentosNuevos,
      cantidad: documentosNuevos.length
    };
  } catch (error) {
    console.error('Error durante la verificaciÃ³n manual:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('procesar-documento-nuevo', async (event, { documento, asunto }) => {
  try {
    if (!documento || !documento.ruta || !documento.nombre) {
      return { success: false, error: 'Datos del documento invÃ¡lidos' };
    }
    if (asunto && !esTextoSeguro(asunto, 500)) {
      return { success: false, error: 'Asunto demasiado largo (mÃ¡x 500 caracteres)' };
    }
    console.log(`Procesando documento nuevo: ${documento.nombre} con asunto: "${asunto}"`);
    const resultado = await procesarDocumentoNuevo(documento, asunto);
    return { ...resultado, documento };
  } catch (error) {
    console.error('Error al procesar documento nuevo:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('configurar-verificacion-automatica', async (event, { activa }) => {
  verificacionAutomaticaActiva = !!activa; // Forzar booleano
  console.log(`VerificaciÃ³n automÃ¡tica ${verificacionAutomaticaActiva ? 'activada' : 'desactivada'}`);

  // Si se estÃ¡ activando y no hay timer, iniciarlo
  if (verificacionAutomaticaActiva && !timerVerificacion) {
    timerVerificacion = setInterval(() => {
      if (verificacionAutomaticaActiva) {
        verificarDocumentosNuevos().catch(err => {
          console.error('Error en la verificaciÃ³n automÃ¡tica:', err);
        });
      }
    }, INTERVALO_VERIFICACION);
    console.log('Timer de verificaciÃ³n iniciado');
  }
  // Si se estÃ¡ desactivando y hay timer, detenerlo
  else if (!verificacionAutomaticaActiva && timerVerificacion) {
    clearInterval(timerVerificacion);
    timerVerificacion = null;
    console.log('Timer de verificaciÃ³n detenido');
  }

  return { success: true, activa: verificacionAutomaticaActiva };
});

// NUEVO MANEJADOR IPC PARA ACTUALIZAR ASUNTO
ipcMain.handle('actualizar-asunto-documento', async (event, { ruta, nuevoAsunto }) => {
  try {
    if (!ruta || typeof ruta !== 'string') {
      return { success: false, error: 'Ruta invÃ¡lida' };
    }
    if (!esTextoSeguro(nuevoAsunto, 500)) {
      return { success: false, error: 'Asunto invÃ¡lido o demasiado largo (mÃ¡x 500 caracteres)' };
    }
    console.log(`Solicitud de actualizaciÃ³n de asunto para: ${ruta}`);

    const resultado = await database.actualizarAsuntoDocumento(ruta, nuevoAsunto.trim());
    console.log('Asunto actualizado correctamente en la base de datos');

    return {
      success: true,
      message: 'Asunto actualizado correctamente',
      cambios: resultado.cambios
    };
  } catch (error) {
    console.error('Error al actualizar asunto del documento:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// NUEVOS MANEJADORES IPC PARA CONTROL DE INDEXACIÃ“N
ipcMain.handle('pausar-indexacion', async (event) => {
  try {
    if (indexacionEnProgreso && !indexacionPausada) {
      indexacionPausada = true;
      console.log('IndexaciÃ³n pausada por el usuario');
      return { success: true, message: 'IndexaciÃ³n pausada' };
    }
    return { success: false, message: 'No hay indexaciÃ³n en progreso o ya estÃ¡ pausada' };
  } catch (error) {
    console.error('Error al pausar indexaciÃ³n:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('reanudar-indexacion', async (event) => {
  try {
    if (indexacionEnProgreso && indexacionPausada) {
      indexacionPausada = false;
      console.log('IndexaciÃ³n reanudada por el usuario');
      return { success: true, message: 'IndexaciÃ³n reanudada' };
    }
    return { success: false, message: 'No hay indexaciÃ³n pausada para reanudar' };
  } catch (error) {
    console.error('Error al reanudar indexaciÃ³n:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('cancelar-indexacion', async (event) => {
  try {
    if (indexacionEnProgreso) {
      indexacionCancelada = true;
      console.log('IndexaciÃ³n cancelada por el usuario');
      return { success: true, message: 'IndexaciÃ³n cancelada' };
    }
    return { success: false, message: 'No hay indexaciÃ³n en progreso para cancelar' };
  } catch (error) {
    console.error('Error al cancelar indexaciÃ³n:', error);
    return { success: false, error: error.message };
  }
});

// NUEVOS MANEJADORES PARA SELECCIÃ“N DE ARCHIVOS
ipcMain.handle('seleccionar-archivos', async (event) => {
  try {
    console.log('Abriendo diÃ¡logo de selecciÃ³n de archivos...');

    const resultado = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      title: 'Seleccionar archivos para indexar',
      buttonLabel: 'Seleccionar',
      filters: [
        { name: 'Documentos', extensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'jpg', 'jpeg', 'png'] }
      ]
    });

    if (resultado.canceled) {
      console.log('SelecciÃ³n de archivos cancelada por el usuario');
      return { success: false, canceled: true };
    }

    const archivosSeleccionados = resultado.filePaths;
    console.log(`${archivosSeleccionados.length} archivos seleccionados`);

    return {
      success: true,
      files: archivosSeleccionados
    };
  } catch (error) {
    console.error('Error al mostrar diÃ¡logo de selecciÃ³n de archivos:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('indexar-archivos-seleccionados', async (event, { archivos: archivosPaths, filtros }) => {
  try {
    if (!Array.isArray(archivosPaths)) {
      return { success: false, error: 'Datos invÃ¡lidos' };
    }
    // Filtrar solo archivos con extensiÃ³n permitida
    const archivosSeguras = archivosPaths.filter(r => esRutaSegura(r));
    console.log(`Solicitud de indexaciÃ³n de ${archivosSeguras.length} archivos vÃ¡lidos (de ${archivosPaths.length})`);

    // Mapear paths a objetos de documento
    const documentos = archivosSeguras.map(rutaCompleta => {
      // Verificar si existe antes de procesar
      if (!fs.existsSync(rutaCompleta)) return null;

      const stats = fs.statSync(rutaCompleta);
      const elemento = path.basename(rutaCompleta);
      const extension = path.extname(rutaCompleta).toLowerCase();

      // Aplicar filtros
      if (filtros) {
        if (filtros.type && filtros.type !== 'all') {
            if (filtros.type === 'pdf' && extension !== '.pdf') return null;
            if (filtros.type === 'word' && !['.doc', '.docx'].includes(extension)) return null;
            if (filtros.type === 'excel' && !['.xls', '.xlsx'].includes(extension)) return null;
            if (filtros.type === 'image' && !['.jpg', '.jpeg', '.png'].includes(extension)) return null;
        }
        const fechaArchivo = stats.mtime.toISOString().split('T')[0];
        if (filtros.dateFrom && fechaArchivo < filtros.dateFrom) return null;
        if (filtros.dateTo && fechaArchivo > filtros.dateTo) return null;
      }

      return {
        nombre: elemento,
        ruta: rutaCompleta,
        tipo: determinarTipoDocumento(elemento),
        fecha: stats.mtime.toISOString().split('T')[0],
        extension: extension
      };
    }).filter(doc => doc !== null); // Filtrar nulos si algÃºn archivo fue borrado

    // Iniciar indexaciÃ³n global (usa las mismas variables de control)
    indexacionEnProgreso = true;
    indexacionPausada = false;
    indexacionCancelada = false;

    const resultado = await procesarListaDeDocumentos(documentos);
    return resultado;
  } catch (error) {
    console.error('Error durante la indexaciÃ³n de archivos especÃ­ficos:', error);
    return { success: false, error: error.message };
  }
});

// Manejador para abrir archivo en carpeta
ipcMain.handle('abrir-en-carpeta', async (event, ruta) => {
  try {
    if (!esRutaSegura(ruta)) {
      console.error('Ruta no permitida para abrir en carpeta:', ruta);
      return { success: false, error: 'Tipo de archivo no permitido' };
    }
    console.log(`Abriendo en carpeta: ${ruta}`);
    if (!fs.existsSync(ruta)) {
      return { success: false, error: 'El archivo no existe' };
    }
    shell.showItemInFolder(ruta);
    return { success: true };
  } catch (error) {
    console.error('Error al abrir en carpeta:', error);
    return { success: false, error: error.message };
  }
});

// NUEVOS MANEJADORES PARA DESCARGA DE DOCUMENTOS
ipcMain.handle('descargar-documento', async (event, rutaOrigen) => {
  try {
    if (!esRutaSegura(rutaOrigen)) {
      return { success: false, error: 'Tipo de archivo no permitido' };
    }
    console.log(`Solicitud de descarga para: ${rutaOrigen}`);

    if (!fs.existsSync(rutaOrigen)) {
      return { success: false, error: 'El archivo original no existe' };
    }

    const extension = path.extname(rutaOrigen);
    const nombreArchivo = path.basename(rutaOrigen);

    // Mostrar diÃ¡logo de guardar
    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Guardar documento',
      defaultPath: nombreArchivo,
      buttonLabel: 'Guardar'
    });

    if (!filePath) {
      return { success: false, canceled: true };
    }

    // Copiar el archivo
    fs.copyFileSync(rutaOrigen, filePath);
    console.log(`Archivo guardado en: ${filePath}`);

    return { success: true, path: filePath };
  } catch (error) {
    console.error('Error al descargar documento:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('descargar-varios-documentos', async (event, rutas) => {
  try {
    if (!Array.isArray(rutas)) {
      return { success: false, error: 'Datos invÃ¡lidos' };
    }
    // Filtrar solo rutas seguras y existentes
    const archivosValidos = rutas.filter(r => esRutaSegura(r) && fs.existsSync(r));
    console.log(`Solicitud de descarga masiva: ${archivosValidos.length} de ${rutas.length} archivos vÃ¡lidos`);
    if (archivosValidos.length === 0) {
      return { success: false, error: 'Ninguno de los archivos seleccionados existe' };
    }

    // Seleccionar carpeta de destino
    const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
      title: 'Seleccionar carpeta de destino',
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Descargar aquÃ­'
    });

    if (canceled || filePaths.length === 0) {
      return { success: false, canceled: true };
    }

    const carpetaDestino = filePaths[0];
    let exitosos = 0;
    let errores = 0;

    for (const rutaOrigen of archivosValidos) {
      try {
        const nombreOriginal = path.basename(rutaOrigen);
        let rutaDestino = path.join(carpetaDestino, nombreOriginal);

        // Manejar duplicados en destino
        let contador = 1;
        const nombreBase = path.parse(nombreOriginal).name;
        const ext = path.parse(nombreOriginal).ext;

        while (fs.existsSync(rutaDestino)) {
          rutaDestino = path.join(carpetaDestino, `${nombreBase} (${contador})${ext}`);
          contador++;
        }

        fs.copyFileSync(rutaOrigen, rutaDestino);
        exitosos++;
      } catch (err) {
        console.error(`Error al copiar ${rutaOrigen}:`, err);
        errores++;
      }
    }

    return {
      success: true,
      total: archivosValidos.length,
      exitosos,
      errores,
      carpeta: carpetaDestino
    };
  } catch (error) {
    console.error('Error en descarga masiva:', error);
    return { success: false, error: error.message };
  }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• ENTERPRISE IPC HANDLERS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

ipcMain.handle('enterprise-get-config', async () => {
  return enterpriseConfig || null;
});

ipcMain.handle('enterprise-set-config', async (event, { dbPath }) => {
  try {
    if (!dbPath || typeof dbPath !== 'string' || dbPath.length > 1000) {
      return { success: false, error: 'Ruta de base de datos invÃ¡lida' };
    }
    // Validar que la raÃ­z de la ruta sea accesible (la carpeta KrawlDB se crea sola)
    const parsedPath = require('path').parse(dbPath);
    const rootDir = parsedPath.root || require('path').dirname(dbPath);
    if (!fs.existsSync(rootDir)) {
      return { success: false, error: 'Unidad no accesible: ' + rootDir + '. Verifica que Google Drive estÃ© montado.' };
    }
    // Guardar config
    const newConfig = { dbPath };
    guardarConfigEnterprise(newConfig);
    enterpriseConfig = newConfig;
    // Reiniciar DB con nueva ruta
    await database.inicializar(dbPath);
    enterpriseConnected = true;
    console.log('Config enterprise guardada. DB reiniciada con:', dbPath);
    return { success: true };
  } catch (error) {
    console.error('Error en enterprise-set-config:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('enterprise-select-db-folder', async () => {
  try {
    const resultado = await dialog.showOpenDialog(mainWindow, {
      title: 'Seleccionar base de datos compartida (documentos.sqlite)',
      properties: ['openFile'],
      buttonLabel: 'Seleccionar',
      filters: [
        { name: 'Base de datos Krawl', extensions: ['sqlite'] },
        { name: 'Todos los archivos', extensions: ['*'] }
      ]
    });
    if (resultado.canceled || resultado.filePaths.length === 0) {
      return { success: false, canceled: true };
    }
    const dbPath = resultado.filePaths[0];
    return { success: true, dbPath };
  } catch (error) {
    console.error('Error en enterprise-select-db-folder:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('enterprise-create-db', async () => {
  try {
    const resultado = await dialog.showOpenDialog(mainWindow, {
      title: 'Seleccionar carpeta donde crear la base de datos compartida',
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Crear aqui'
    });
    if (resultado.canceled || resultado.filePaths.length === 0) {
      return { success: false, canceled: true };
    }
    const carpeta = resultado.filePaths[0];
    const dbPath = require('path').join(carpeta, 'documentos.sqlite');
    return { success: true, dbPath };
  } catch (error) {
    console.error('Error en enterprise-create-db:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('enterprise-db-status', async () => {
  if (!enterpriseConfig || !enterpriseConfig.dbPath) {
    return { connected: false, path: null };
  }
  return {
    connected: enterpriseConnected,
    path: enterpriseConnected ? enterpriseConfig.dbPath : null,
    error: !enterpriseConnected ? ('Ruta no accesible: ' + enterpriseConfig.dbPath) : undefined
  };
});
