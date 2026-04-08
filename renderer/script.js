document.addEventListener('DOMContentLoaded', () => {
  // Referencias a elementos del DOM
  const searchBtn = document.getElementById('searchBtn');
  const resetBtn = document.getElementById('resetBtn');
  const resultsContainer = document.getElementById('results-container');

  // ═══════════════ AUTO-ACTUALIZACIÓN ═══════════════
  const updateBanner = document.getElementById('update-banner');
  const updateMessage = document.getElementById('update-message');
  const updateActionBtn = document.getElementById('update-action-btn');
  const updateDismissBtn = document.getElementById('update-dismiss-btn');
  const updateProgressBar = document.getElementById('update-progress-bar');
  const updateProgressFill = document.getElementById('update-progress-fill');
  let updateState = 'idle'; // idle | available | downloading | downloaded

  // Mostrar versión de la app
  if (window.electronAPI.getAppVersion) {
    window.electronAPI.getAppVersion().then(v => {
      const versionEl = document.getElementById('app-version');
      if (versionEl) versionEl.textContent = `v${v}`;
    });
  }

  // Escuchar eventos de actualización
  if (window.electronAPI.onUpdateAvailable) {
    window.electronAPI.onUpdateAvailable((data) => {
      updateState = 'available';
      updateMessage.textContent = `Nueva versión ${data.version} disponible`;
      updateActionBtn.textContent = 'Descargar';
      updateActionBtn.disabled = false;
      updateBanner.classList.remove('hidden');
      updateProgressBar.classList.add('hidden');
    });

    window.electronAPI.onUpdateProgress((data) => {
      updateProgressBar.classList.remove('hidden');
      updateProgressFill.style.width = `${data.percent}%`;
      updateMessage.textContent = `Descargando actualización... ${data.percent}%`;
    });

    window.electronAPI.onUpdateDownloaded((data) => {
      updateState = 'downloaded';
      updateMessage.textContent = `Versión ${data.version} lista para instalar`;
      updateActionBtn.textContent = 'Reiniciar e Instalar';
      updateActionBtn.disabled = false;
      updateProgressBar.classList.add('hidden');
    });
  }

  if (updateActionBtn) {
    updateActionBtn.addEventListener('click', async () => {
      if (updateState === 'available') {
        updateState = 'downloading';
        updateActionBtn.textContent = 'Descargando...';
        updateActionBtn.disabled = true;
        await window.electronAPI.downloadUpdate();
      } else if (updateState === 'downloaded') {
        window.electronAPI.installUpdate();
      }
    });
  }

  if (updateDismissBtn) {
    updateDismissBtn.addEventListener('click', () => {
      updateBanner.classList.add('hidden');
    });
  }
  const loadingIndicator = document.getElementById('loading');

  // Referencias para indexación de rutas
  const selectedPathInput = document.getElementById('selectedPath');
  const browseFolderBtn = document.getElementById('browseFolderBtn');
  const browseFilesBtn = document.getElementById('browseFilesBtn');
  const indexBtn = document.getElementById('indexBtn');
  const indexingStatus = document.getElementById('indexingStatus');
  const radioButtons = document.querySelectorAll('input[name="indexingMode"]');

  // Estado de selección
  let selectedFilesList = [];
  let indexingMode = 'folder'; // 'folder' | 'files'

  // Variables para control de progreso
  let indexacionEnProgreso = false;
  let indexacionPausada = false;
  let indexacionCancelada = false;

  // Estado de paginación
  let paginaActual = 1;
  const RESULTADOS_POR_PAGINA = 50;
  let ultimosCriterios = null; // Para navegar entre páginas sin re-leer campos

  // Función para buscar documentos (con paginación)
  async function buscarDocumentos(pagina = 1) {
    const keyword = document.getElementById('keyword').value;
    const dateFrom = document.getElementById('dateFrom').value;
    const dateTo = document.getElementById('dateTo').value;
    const documentType = document.getElementById('documentType').value;

    loadingIndicator.classList.remove('hidden');
    resultsContainer.innerHTML = '';

    try {
      const criterios = { keyword, dateFrom, dateTo, documentType, page: pagina, pageSize: RESULTADOS_POR_PAGINA };
      ultimosCriterios = criterios;
      const respuesta = await window.electronAPI.buscarDocumentos(criterios);

      const { resultados, total, page, totalPages } = respuesta;
      paginaActual = page;

      if (total === 0) {
        resultsContainer.innerHTML = '<div class="no-results">No se encontraron documentos que coincidan con los criterios de búsqueda.</div>';
      } else {
        mostrarResultados(resultados, total, page, totalPages);
      }
    } catch (error) {
      resultsContainer.innerHTML = `<div class="error">Error al realizar la búsqueda: ${error.message}</div>`;
    } finally {
      loadingIndicator.classList.add('hidden');
    }
  }

  // Función optimizada para mostrar resultados (con paginación)
  function mostrarResultados(resultados, total, page, totalPages) {
    const tableContainer = document.createElement('div');
    tableContainer.className = 'table-container';

    const tabla = document.createElement('table');
    tabla.className = 'results-table';

    // Crear encabezado
    const thead = document.createElement('thead');
    thead.innerHTML = `
      <tr>
        <th>Nombre</th>
        <th>Fecha</th>
        <th>Tipo</th>
        <th>Asunto</th>
        <th>Acciones</th>
      </tr>
    `;
    tabla.appendChild(thead);

    // Crear cuerpo de la tabla
    const tbody = document.createElement('tbody');

    resultados.forEach(doc => {
      const tr = document.createElement('tr');

      // Funciones auxiliares
      function escapeHtml(unsafe) {
        if (!unsafe) return '';
        return unsafe
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#039;");
      }

      function formatearFecha(fecha) {
        if (!fecha) return 'N/A';
        try {
          if (typeof fecha === 'string' && fecha.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
            return fecha;
          }
          const date = new Date(fecha);
          if (isNaN(date.getTime())) {
            return fecha || 'N/A';
          }
          return date.toLocaleDateString('es-ES', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
          });
        } catch {
          return fecha || 'N/A';
        }
      }

      // Estructura de la fila con edición inline
      tr.innerHTML = `
        <td title="${escapeHtml(doc.nombre)}">${escapeHtml(doc.nombre)}</td>
        <td>${formatearFecha(doc.fecha)}</td>
        <td>${escapeHtml(doc.tipo || 'N/A')}</td>
        <td class="asunto-cell" data-ruta="${escapeHtml(doc.ruta)}">
          <div class="asunto-display">
            <span class="asunto-text" title="${escapeHtml(doc.asunto || 'Sin asunto')}">
              ${escapeHtml(doc.asunto || 'Sin asunto')}
            </span>
            <button class="btn-edit-asunto" title="Editar asunto">✏️</button>
          </div>
          <div class="asunto-edit">
            <input type="text" class="asunto-input" value="${escapeHtml(doc.asunto || '')}" placeholder="Escribir asunto...">
            <button class="btn-save-asunto" title="Guardar">💾</button>
            <button class="btn-cancel-asunto" title="Cancelar">✕</button>
          </div>
        </td>
        <td>
          <div class="action-buttons">
            <button class="btn-open" data-path="${escapeHtml(doc.ruta)}" title="Abrir documento">Abrir</button>
            <button class="btn-open-folder" data-path="${escapeHtml(doc.ruta)}" title="Abrir en carpeta">📂</button>
            <button class="btn-copy" data-path="${escapeHtml(doc.ruta)}" title="Copiar ruta">Copiar</button>
            <button class="btn-download" data-path="${escapeHtml(doc.ruta)}" title="Descargar documento">📥</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });

    tabla.appendChild(tbody);
    tableContainer.appendChild(tabla);

    // Estadísticas con info de paginación
    const desde = (page - 1) * RESULTADOS_POR_PAGINA + 1;
    const hasta = Math.min(page * RESULTADOS_POR_PAGINA, total);
    const statsDiv = document.createElement('div');
    statsDiv.style.cssText = `
      margin-bottom: 16px; 
      padding: 12px 16px; 
      background: #f0f9ff; 
      border: 1px solid #bae6fd;
      border-radius: 6px; 
      color: #0c4a6e;
      font-weight: 500;
      font-size: 14px;
    `;
    statsDiv.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span>Mostrando ${desde}-${hasta} de ${total} documento${total !== 1 ? 's' : ''}</span>
        ${resultados.length > 0 ? `<button id="btn-download-all" class="secondary-btn" style="padding: 4px 12px; font-size: 13px;">📥 Descargar Página (${resultados.length})</button>` : ''}
      </div>
    `;

    resultsContainer.innerHTML = '';
    resultsContainer.appendChild(statsDiv);
    resultsContainer.appendChild(tableContainer);

    // Controles de paginación
    if (totalPages > 1) {
      const paginationDiv = crearControlesPaginacion(page, totalPages);
      resultsContainer.appendChild(paginationDiv);
    }

    // Eventos para edición de asuntos
    configurarEdicionAsuntos();
    configurarAccionesDocumentos();

    // Evento para descargar todo
    const btnDownloadAll = document.getElementById('btn-download-all');
    if (btnDownloadAll) {
      btnDownloadAll.addEventListener('click', async () => {
        const rutas = resultados.map(r => r.ruta);
        await descargarVariosDocumentos(rutas, btnDownloadAll);
      });
    }
  }

  // Crear controles de paginación
  function crearControlesPaginacion(page, totalPages) {
    const div = document.createElement('div');
    div.className = 'pagination';

    // Botón anterior
    const btnPrev = document.createElement('button');
    btnPrev.className = 'pagination-btn';
    btnPrev.textContent = '← Anterior';
    btnPrev.disabled = page <= 1;
    btnPrev.addEventListener('click', () => buscarDocumentos(page - 1));
    div.appendChild(btnPrev);

    // Números de página (mostrar rango inteligente)
    const paginas = calcularRangoPaginas(page, totalPages);
    paginas.forEach(p => {
      if (p === '...') {
        const dots = document.createElement('span');
        dots.className = 'pagination-dots';
        dots.textContent = '...';
        div.appendChild(dots);
      } else {
        const btn = document.createElement('button');
        btn.className = 'pagination-btn' + (p === page ? ' pagination-active' : '');
        btn.textContent = p;
        btn.addEventListener('click', () => buscarDocumentos(p));
        div.appendChild(btn);
      }
    });

    // Botón siguiente
    const btnNext = document.createElement('button');
    btnNext.className = 'pagination-btn';
    btnNext.textContent = 'Siguiente →';
    btnNext.disabled = page >= totalPages;
    btnNext.addEventListener('click', () => buscarDocumentos(page + 1));
    div.appendChild(btnNext);

    return div;
  }

  // Calcular qué números de página mostrar
  function calcularRangoPaginas(page, totalPages) {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const pages = [];
    pages.push(1);
    if (page > 3) pages.push('...');
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
      pages.push(i);
    }
    if (page < totalPages - 2) pages.push('...');
    pages.push(totalPages);
    return pages;
  }

  // Configurar edición inline de asuntos
  function configurarEdicionAsuntos() {
    // Botones de editar
    document.querySelectorAll('.btn-edit-asunto').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cell = btn.closest('.asunto-cell');
        const displayDiv = cell.querySelector('.asunto-display');
        const editDiv = cell.querySelector('.asunto-edit');
        const input = cell.querySelector('.asunto-input');

        displayDiv.style.display = 'none';
        editDiv.style.display = 'flex';
        input.focus();
        input.select();
      });
    });

    // Botones de guardar
    document.querySelectorAll('.btn-save-asunto').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await guardarAsunto(btn);
      });
    });

    // Botones de cancelar
    document.querySelectorAll('.btn-cancel-asunto').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        cancelarEdicion(btn);
      });
    });

    // Atajos de teclado
    document.querySelectorAll('.asunto-input').forEach(input => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const saveBtn = input.closest('.asunto-edit').querySelector('.btn-save-asunto');
          saveBtn.click();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          const cancelBtn = input.closest('.asunto-edit').querySelector('.btn-cancel-asunto');
          cancelBtn.click();
        }
      });
    });
  }

  // Guardar asunto editado
  async function guardarAsunto(btn) {
    const cell = btn.closest('.asunto-cell');
    const ruta = cell.dataset.ruta;
    const input = cell.querySelector('.asunto-input');
    const nuevoAsunto = input.value.trim();

    if (nuevoAsunto === '') {
      mostrarNotificacion('El asunto no puede estar vacío', 'error');
      return;
    }

    btn.disabled = true;
    const textoOriginal = btn.innerHTML;
    btn.innerHTML = '⏳';

    try {
      const resultado = await window.electronAPI.actualizarAsuntoDocumento(ruta, nuevoAsunto);

      if (resultado.success) {
        // Actualizar vista
        const asuntoText = cell.querySelector('.asunto-text');
        asuntoText.textContent = nuevoAsunto;
        asuntoText.title = nuevoAsunto;

        // Volver a modo vista
        const displayDiv = cell.querySelector('.asunto-display');
        const editDiv = cell.querySelector('.asunto-edit');
        editDiv.style.display = 'none';
        displayDiv.style.display = 'flex';

        mostrarNotificacion('Asunto actualizado correctamente', 'success');
      } else {
        mostrarNotificacion(`Error: ${resultado.error}`, 'error');
      }
    } catch (error) {
      mostrarNotificacion(`Error al actualizar: ${error.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = textoOriginal;
    }
  }

  // Cancelar edición
  function cancelarEdicion(btn) {
    const cell = btn.closest('.asunto-cell');
    const displayDiv = cell.querySelector('.asunto-display');
    const editDiv = cell.querySelector('.asunto-edit');
    const input = cell.querySelector('.asunto-input');
    const originalValue = cell.querySelector('.asunto-text').textContent;

    input.value = originalValue;
    editDiv.style.display = 'none';
    displayDiv.style.display = 'flex';
  }

  // Configurar acciones de documentos
  function configurarAccionesDocumentos() {
    // Botones de abrir
    document.querySelectorAll('.btn-open').forEach(btn => {
      btn.addEventListener('click', async () => {
        const originalText = btn.innerHTML;
        btn.innerHTML = '⏳';
        btn.disabled = true;

        try {
          const resultado = await window.electronAPI.abrirDocumento(btn.dataset.path);
          if (!resultado.success) {
            mostrarNotificacion(`Error al abrir: ${resultado.error}`, 'error');
          } else {
            btn.innerHTML = '✓';
            setTimeout(() => {
              btn.innerHTML = originalText;
              btn.disabled = false;
            }, 2000);
          }
        } catch (error) {
          mostrarNotificacion(`Error: ${error.message}`, 'error');
        } finally {
          if (btn.innerHTML === '⏳') {
            btn.innerHTML = originalText;
            btn.disabled = false;
          }
        }
      });
    });

    // Botones de abrir en carpeta
    document.querySelectorAll('.btn-open-folder').forEach(btn => {
      btn.addEventListener('click', async () => {
        const originalText = btn.innerHTML;
        btn.innerHTML = '⏳';
        btn.disabled = true;

        try {
          const resultado = await window.electronAPI.abrirEnCarpeta(btn.dataset.path);
          if (!resultado.success) {
            mostrarNotificacion(`Error al abrir carpeta: ${resultado.error}`, 'error');
          } else {
            // No necesitamos feedback visual largo porque la carpeta se abrirá encima
            btn.innerHTML = '✓';
            setTimeout(() => {
              btn.innerHTML = originalText;
              btn.disabled = false;
            }, 1000);
          }
        } catch (error) {
          mostrarNotificacion(`Error: ${error.message}`, 'error');
          btn.innerHTML = '❌';
          setTimeout(() => {
            btn.innerHTML = originalText;
            btn.disabled = false;
          }, 2000);
        }
      });
    });

    // Botones de copiar
    document.querySelectorAll('.btn-copy').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(btn.dataset.path);
          const originalText = btn.innerHTML;
          btn.innerHTML = '✓';
          setTimeout(() => {
            btn.innerHTML = originalText;
          }, 2000);
          mostrarNotificacion('Ruta copiada al portapapeles', 'success');
        } catch (err) {
          mostrarNotificacion(`Error al copiar: ${err.message}`, 'error');
        }
      });
    });

    // Botones de descargar individual
    document.querySelectorAll('.btn-download').forEach(btn => {
      btn.addEventListener('click', async () => {
        const originalText = btn.innerHTML;
        btn.innerHTML = '⏳';
        btn.disabled = true;

        try {
          const resultado = await window.electronAPI.descargarDocumento(btn.dataset.path);

          if (resultado.success) {
            mostrarNotificacion(`Documento guardado en: ${resultado.path}`, 'success');
            btn.innerHTML = '✓';
          } else if (resultado.canceled) {
            btn.innerHTML = originalText; // Restaurar si cancela
          } else {
            mostrarNotificacion(`Error: ${resultado.error}`, 'error');
            btn.innerHTML = '❌';
          }
        } catch (error) {
          mostrarNotificacion(`Error: ${error.message}`, 'error');
          btn.innerHTML = '❌';
        } finally {
          if (btn.innerHTML !== originalText && btn.innerHTML !== '⏳') {
            setTimeout(() => {
              btn.innerHTML = originalText;
              btn.disabled = false;
            }, 2000);
          } else if (btn.innerHTML === '⏳') {
            btn.innerHTML = originalText;
            btn.disabled = false;
          }
        }
      });
    });
  }

  // Nueva función para descargar varios documentos
  async function descargarVariosDocumentos(rutas, btn) {
    const originalText = btn.innerHTML;
    btn.innerHTML = '⏳ Preparando descarga...';
    btn.disabled = true;

    try {
      const resultado = await window.electronAPI.descargarVariosDocumentos(rutas);

      if (resultado.success) {
        mostrarNotificacion(`Descarga completada. ${resultado.exitosos} archivos guardados en ${resultado.carpeta}`, 'success');
        if (resultado.errores > 0) {
          mostrarNotificacion(`Hubo ${resultado.errores} errores durante la descarga.`, 'warning');
        }
      } else if (resultado.canceled) {
        mostrarNotificacion('Descarga cancelada', 'info');
      } else {
        mostrarNotificacion(`Error: ${resultado.error}`, 'error');
      }
    } catch (error) {
      mostrarNotificacion(`Error grave: ${error.message}`, 'error');
    } finally {
      btn.innerHTML = originalText;
      btn.disabled = false;
    }
  }

  // Mostrar notificaciones
  function mostrarNotificacion(mensaje, tipo = 'info') {
    const notificacion = document.createElement('div');
    notificacion.className = 'notification';

    const colores = {
      success: '#10b981',
      error: '#ef4444',
      info: '#3b82f6'
    };

    notificacion.style.background = colores[tipo] || colores.info;
    notificacion.textContent = mensaje;

    document.body.appendChild(notificacion);

    setTimeout(() => {
      if (notificacion.parentNode) {
        notificacion.parentNode.removeChild(notificacion);
      }
    }, 3000);
  }

  // Funciones de indexación

  // Cambiar modo de selección
  radioButtons.forEach(radio => {
    radio.addEventListener('change', (e) => {
      indexingMode = e.target.value;
      resetSelection();

      if (indexingMode === 'folder') {
        browseFolderBtn.classList.remove('hidden');
        browseFilesBtn.classList.add('hidden');
        document.getElementById('pathLabel').textContent = 'Ruta a indexar:';
        selectedPathInput.placeholder = 'Seleccione una carpeta...';
      } else {
        browseFolderBtn.classList.add('hidden');
        browseFilesBtn.classList.remove('hidden');
        document.getElementById('pathLabel').textContent = 'Archivos seleccionados:';
        selectedPathInput.placeholder = 'Seleccione archivos...';
      }
    });
  });

  function resetSelection() {
    selectedPathInput.value = '';
    selectedFilesList = [];
    indexBtn.disabled = true;
    indexingStatus.classList.add('hidden');
  }

  async function examinarCarpeta() {
    try {
      const resultado = await window.electronAPI.seleccionarCarpeta();
      if (resultado.success && resultado.path) {
        selectedPathInput.value = resultado.path;
        indexBtn.disabled = false;
        actualizarEstadoIndexacion('Carpeta seleccionada', 'success');
      }
    } catch (error) {
      actualizarEstadoIndexacion(`Error: ${error.message}`, 'error');
    }
  }

  async function examinarArchivos() {
    try {
      const resultado = await window.electronAPI.seleccionarArchivos();
      if (resultado.success && resultado.files && resultado.files.length > 0) {
        selectedFilesList = resultado.files;
        selectedPathInput.value = `${selectedFilesList.length} archivo(s) seleccionado(s)`;
        indexBtn.disabled = false;
        actualizarEstadoIndexacion(`${selectedFilesList.length} archivos seleccionados`, 'success');
      }
    } catch (error) {
      actualizarEstadoIndexacion(`Error: ${error.message}`, 'error');
    }
  }
  // FUNCIÓN DE INDEXACIÓN ACTUALIZADA PARA SECCIÓN INTEGRADA
  async function indexarRutaEspecifica() {

    if (indexingMode === 'folder' && !selectedPathInput.value) {
      actualizarEstadoIndexacion('Seleccione una carpeta primero', 'error');
      return;
    }

    if (indexingMode === 'files' && selectedFilesList.length === 0) {
      actualizarEstadoIndexacion('Seleccione archivos primero', 'error');
      return;
    }

    const filtros = {
      type: document.getElementById('indexDocumentType').value,
      dateFrom: document.getElementById('indexDateFrom').value,
      dateTo: document.getElementById('indexDateTo').value
    };

    // Configurar estado inicial
    indexacionEnProgreso = true;
    indexacionPausada = false;
    indexacionCancelada = false;

    // Mostrar sección de progreso integrada
    resetProgressSection();
    showProgressSection();

    // Desactivar botón de indexar
    indexBtn.disabled = true;
    const textoOriginal = indexBtn.innerHTML;
    indexBtn.innerHTML = 'Indexando...';
    actualizarEstadoIndexacion('Iniciando indexación...', 'loading');

    // Configurar listener para progreso en tiempo real
    const removerListener = window.electronAPI.onIndexacionProgreso((data) => {
      switch (data.tipo) {
        case 'inicio':
          updateProgressSection({
            total: data.total,
            processed: data.processed,
            success: data.success,
            errors: data.errors,
            existing: data.existing || 0,
            currentFile: data.currentFile,
            elapsedTime: '00:00',
            estimatedTime: 'Calculando...'
          });
          break;

        case 'progreso':
          updateProgressSection({
            total: data.total,
            processed: data.processed,
            success: data.success,
            errors: data.errors,
            existing: data.existing || 0,
            currentFile: data.currentFile,
            elapsedTime: data.elapsedTime,
            estimatedTime: data.estimatedTime
          });
          break;

        case 'existente':
          // Un archivo ya existía - actualizar contadores
          updateProgressSection({
            existing: data.existing,
            processed: data.processed,
            currentFile: `⏭️ ${data.archivo} (ya indexado)`
          });
          break;

        case 'error':
          addProgressError(data.archivo, data.error);
          break;

        case 'completado':
          updateProgressSection({
            total: data.total,
            processed: data.processed,
            success: data.success,
            errors: data.errors,
            existing: data.existing,
            currentFile: data.currentFile,
            elapsedTime: data.elapsedTime,
            estimatedTime: data.estimatedTime
          });

          // Marcar como completado y mostrar resumen
          markProgressCompleted();
          showProgressSummary({
            total: data.total,
            processed: data.processed,
            success: data.success,
            errors: data.errors,
            existing: data.existing,
            totalTime: data.elapsedTime
          });

          const mensaje = `Completado: ${data.success} nuevos, ${data.existing} existían, ${data.errors} errores`;
          actualizarEstadoIndexacion(mensaje, 'success');
          mostrarNotificacion(mensaje, 'success');
          break;

        case 'todos-existentes':
          // Caso especial: todos los archivos ya estaban indexados
          updateProgressSection({
            total: data.total,
            processed: data.processed,
            success: 0,
            errors: 0,
            existing: data.existing,
            currentFile: '✅ ' + data.currentFile,
            elapsedTime: data.elapsedTime,
            estimatedTime: 'Finalizado'
          });

          markProgressCompleted();

          const mensajeExistentes = `Todos los ${data.existing} archivos ya estaban indexados`;
          actualizarEstadoIndexacion(mensajeExistentes, 'info');
          mostrarNotificacion(mensajeExistentes, 'info');

          setTimeout(() => {
            hideProgressSection();
          }, 4000);
          break;

        case 'sin-documentos':
          actualizarEstadoIndexacion('No se encontraron documentos válidos', 'error');
          mostrarNotificacion('No se encontraron documentos válidos para indexar', 'error');
          hideProgressSection();
          break;

        case 'error-general':
          actualizarEstadoIndexacion(`Error: ${data.error}`, 'error');
          mostrarNotificacion(`Error: ${data.error}`, 'error');
          hideProgressSection();
          break;

        case 'cancelado':
          updateProgressSection({
            total: data.total,
            processed: data.processed,
            success: data.success,
            errors: data.errors,
            existing: data.existing,
            currentFile: data.currentFile,
            elapsedTime: data.elapsedTime,
            estimatedTime: data.estimatedTime
          });

          markProgressCompleted();
          const mensajeCancelado = `Cancelado: ${data.success} procesados, ${data.existing} existían, ${data.errors} errores`;
          actualizarEstadoIndexacion(mensajeCancelado, 'info');
          mostrarNotificacion(mensajeCancelado, 'info');

          setTimeout(() => {
            hideProgressSection();
          }, 3000);
          break;
      }
    });

    try {
      // Ejecutar indexación según el modo
      let resultado;

      if (indexingMode === 'folder') {
        const rutaSeleccionada = selectedPathInput.value;
        resultado = await window.electronAPI.indexarCarpetaEspecifica(rutaSeleccionada, filtros);
      } else {
        // Modo archivos
        resultado = await window.electronAPI.indexarArchivosSeleccionados(selectedFilesList, filtros);
      }

      if (!resultado.success) {
        actualizarEstadoIndexacion(`Error: ${resultado.error}`, 'error');
        mostrarNotificacion(`Error: ${resultado.error}`, 'error');
        hideProgressSection();
      }
    } catch (error) {
      actualizarEstadoIndexacion(`Error: ${error.message}`, 'error');
      mostrarNotificacion(`Error: ${error.message}`, 'error');
      hideProgressSection();
    } finally {
      // Limpiar listener
      removerListener();
      indexacionEnProgreso = false;
      indexBtn.disabled = false;
      indexBtn.innerHTML = textoOriginal;
    }
  }

  function actualizarEstadoIndexacion(mensaje, tipo) {
    indexingStatus.textContent = mensaje;
    indexingStatus.className = `status-text ${tipo}`;
    indexingStatus.classList.remove('hidden');

    if (tipo === 'success') {
      setTimeout(() => {
        indexingStatus.classList.add('hidden');
      }, 5000);
    }
  }

  // Event listeners principales
  searchBtn.addEventListener('click', buscarDocumentos);

  resetBtn.addEventListener('click', () => {
    document.getElementById('keyword').value = '';
    document.getElementById('dateFrom').value = '';
    document.getElementById('dateTo').value = '';
    document.getElementById('documentType').value = '';
    resultsContainer.innerHTML = '';
    mostrarNotificacion('Formulario limpiado', 'info');
  });

  // Event listeners para indexación
  browseFolderBtn.addEventListener('click', examinarCarpeta);
  browseFilesBtn.addEventListener('click', examinarArchivos);
  indexBtn.addEventListener('click', indexarRutaEspecifica);

  // Búsqueda con Enter
  document.getElementById('keyword').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      buscarDocumentos();
    }
  });

  // EVENT LISTENERS PARA CONTROLES DE LA SECCIÓN INTEGRADA
  const pauseBtn = document.getElementById('pause-progress-btn');
  const resumeBtn = document.getElementById('resume-progress-btn');
  const cancelBtn = document.getElementById('cancel-progress-btn');
  if (pauseBtn) {
    pauseBtn.addEventListener('click', async () => {
      if (indexacionEnProgreso && !indexacionPausada) {
        try {
          const resultado = await window.electronAPI.pausarIndexacion();
          if (resultado.success) {
            indexacionPausada = true;
            pauseBtn.classList.add('hidden');
            if (resumeBtn) resumeBtn.classList.remove('hidden');
            updateProgressSection({ currentFile: 'Pausado por el usuario...' });
            mostrarNotificacion('Indexación pausada', 'info');
          } else {
            mostrarNotificacion(`Error al pausar: ${resultado.message}`, 'error');
          }
        } catch (error) {
          mostrarNotificacion(`Error al pausar indexación: ${error.message}`, 'error');
        }
      }
    });
  }
  if (resumeBtn) {
    resumeBtn.addEventListener('click', async () => {
      if (indexacionEnProgreso && indexacionPausada) {
        try {
          const resultado = await window.electronAPI.reanudarIndexacion();
          if (resultado.success) {
            indexacionPausada = false;
            resumeBtn.classList.add('hidden');
            if (pauseBtn) pauseBtn.classList.remove('hidden');
            updateProgressSection({ currentFile: 'Reanudando indexación...' });
            mostrarNotificacion('Indexación reanudada', 'info');
          } else {
            mostrarNotificacion(`Error al reanudar: ${resultado.message}`, 'error');
          }
        } catch (error) {
          mostrarNotificacion(`Error al reanudar indexación: ${error.message}`, 'error');
        }
      }
    });
  }
  if (cancelBtn) {
    cancelBtn.addEventListener('click', async () => {
      if (indexacionEnProgreso) {
        if (confirm('¿Estás seguro de que quieres cancelar la indexación?')) {
          try {
            const resultado = await window.electronAPI.cancelarIndexacion();
            if (resultado.success) {
              indexacionCancelada = true;
              indexacionEnProgreso = false;
              updateProgressSection({ currentFile: 'Cancelado por el usuario' });

              mostrarNotificacion('Indexación cancelada. Los documentos procesados se han guardado.', 'info');

              setTimeout(() => {
                hideProgressSection();
              }, 2000);
            } else {
              mostrarNotificacion(`Error al cancelar: ${resultado.message}`, 'error');
            }
          } catch (error) {
            mostrarNotificacion(`Error al cancelar indexación: ${error.message}`, 'error');
          }
        }
      }
    });
  }
});

// ========================================
// FUNCIONES PARA SECCIÓN DE PROGRESO INTEGRADA
// ========================================

// Función para mostrar la sección de progreso
function showProgressSection() {
  const progressSection = document.getElementById('progress-section');
  if (progressSection) {
    progressSection.classList.remove('hidden');
  }
}

// Función para ocultar la sección de progreso
function hideProgressSection() {
  const progressSection = document.getElementById('progress-section');
  if (progressSection) {
    progressSection.classList.add('hidden');
  }
}

// Función para resetear la sección de progreso
function resetProgressSection() {
  const elements = {
    total: document.getElementById('counter-total'),
    processed: document.getElementById('counter-processed'),
    success: document.getElementById('counter-success'),
    existing: document.getElementById('counter-existing'),
    errors: document.getElementById('counter-errors'),
    progressFill: document.getElementById('main-progress-fill'),
    progressPercentage: document.getElementById('main-progress-percentage'),
    currentFile: document.getElementById('current-processing-file'),
    timeElapsed: document.getElementById('time-elapsed'),
    timeEstimated: document.getElementById('time-estimated'),
    errorsContainer: document.getElementById('errors-container'),
    errorsContent: document.getElementById('errors-content'),
    pauseBtn: document.getElementById('pause-progress-btn'),
    resumeBtn: document.getElementById('resume-progress-btn')
  };

  // Resetear contadores
  if (elements.total) elements.total.textContent = '0';
  if (elements.processed) elements.processed.textContent = '0';
  if (elements.success) elements.success.textContent = '0';
  if (elements.existing) elements.existing.textContent = '0';
  if (elements.errors) elements.errors.textContent = '0';

  // Resetear barra de progreso
  if (elements.progressFill) elements.progressFill.style.width = '0%';
  if (elements.progressPercentage) elements.progressPercentage.textContent = '0%';

  // Resetear archivo actual
  if (elements.currentFile) elements.currentFile.textContent = 'Iniciando...';

  // Resetear tiempos
  if (elements.timeElapsed) elements.timeElapsed.textContent = '00:00';
  if (elements.timeEstimated) elements.timeEstimated.textContent = 'Calculando...';

  // Ocultar errores
  if (elements.errorsContainer) elements.errorsContainer.classList.add('hidden');
  if (elements.errorsContent) {
    elements.errorsContent.classList.add('hidden');
    elements.errorsContent.innerHTML = '';
  }

  // Mostrar botón pausar, ocultar reanudar
  if (elements.pauseBtn) elements.pauseBtn.classList.remove('hidden');
  if (elements.resumeBtn) elements.resumeBtn.classList.add('hidden');
}

// Función para actualizar el progreso integrado
function updateProgressSection(data) {
  const elements = {
    total: document.getElementById('counter-total'),
    processed: document.getElementById('counter-processed'),
    success: document.getElementById('counter-success'),
    existing: document.getElementById('counter-existing'),
    errors: document.getElementById('counter-errors'),
    progressFill: document.getElementById('main-progress-fill'),
    progressPercentage: document.getElementById('main-progress-percentage'),
    currentFile: document.getElementById('current-processing-file'),
    timeElapsed: document.getElementById('time-elapsed'),
    timeEstimated: document.getElementById('time-estimated'),
    errorsContainer: document.getElementById('errors-container'),
    errorsCountDisplay: document.getElementById('errors-count-display')
  };

  // Actualizar contadores
  if (data.total !== undefined && elements.total) {
    elements.total.textContent = data.total;
  }
  if (data.processed !== undefined && elements.processed) {
    elements.processed.textContent = data.processed;
  }
  if (data.success !== undefined && elements.success) {
    elements.success.textContent = data.success;
  }
  if (data.existing !== undefined && elements.existing) {
    elements.existing.textContent = data.existing;
  }
  if (data.errors !== undefined && elements.errors) {
    elements.errors.textContent = data.errors;
  }

  // Actualizar barra de progreso
  if (data.total && data.processed !== undefined && elements.progressFill && elements.progressPercentage) {
    const percentage = data.total > 0 ? Math.round((data.processed / data.total) * 100) : 0;
    elements.progressFill.style.width = `${percentage}%`;
    elements.progressPercentage.textContent = `${percentage}%`;
  }

  // Actualizar archivo actual
  if (data.currentFile && elements.currentFile) {
    elements.currentFile.textContent = data.currentFile;
  }

  // Actualizar tiempos
  if (data.elapsedTime && elements.timeElapsed) {
    elements.timeElapsed.textContent = data.elapsedTime;
  }
  if (data.estimatedTime && elements.timeEstimated) {
    elements.timeEstimated.textContent = data.estimatedTime;
  }

  // Mostrar errores si los hay
  if (data.errors && data.errors > 0 && elements.errorsContainer && elements.errorsCountDisplay) {
    elements.errorsContainer.classList.remove('hidden');
    elements.errorsCountDisplay.textContent = data.errors;
  }
}

// Función para agregar un error a la lista integrada
function addProgressError(filename, errorMessage) {
  const errorsContent = document.getElementById('errors-content');
  if (errorsContent) {
    const errorItem = document.createElement('div');
    errorItem.className = 'error-item-inline';
    errorItem.textContent = `${filename}: ${errorMessage}`;
    errorsContent.appendChild(errorItem);

    // Actualizar contador de errores
    const currentErrors = parseInt(document.getElementById('counter-errors')?.textContent) || 0;
    updateProgressSection({ errors: currentErrors + 1 });
  }
}

// Función para mostrar/ocultar lista de errores
function toggleProgressErrors() {
  const errorsContent = document.getElementById('errors-content');
  const errorsArrow = document.querySelector('.errors-arrow');

  if (errorsContent && errorsArrow) {
    if (errorsContent.classList.contains('hidden')) {
      errorsContent.classList.remove('hidden');
      errorsArrow.classList.add('rotated');
    } else {
      errorsContent.classList.add('hidden');
      errorsArrow.classList.remove('rotated');
    }
  }
}

// Función para marcar como completado
function markProgressCompleted() {
  const progressSection = document.getElementById('progress-section');
  if (progressSection) {
    progressSection.classList.add('completed');
  }

  // Ocultar controles de pausa/reanudar
  const pauseBtn = document.getElementById('pause-progress-btn');
  const resumeBtn = document.getElementById('resume-progress-btn');

  if (pauseBtn) pauseBtn.classList.add('hidden');
  if (resumeBtn) resumeBtn.classList.add('hidden');
}

// Función para mostrar resumen final integrado
function showProgressSummary(data) {
  // Actualizar con datos finales
  updateProgressSection({
    total: data.total,
    processed: data.processed,
    success: data.success || data.processed,
    errors: data.errors || 0,
    currentFile: `✅ Completado: ${data.success || 0} nuevos, ${data.existing || 0} existían`,
    elapsedTime: data.totalTime || data.elapsedTime || '00:00',
    estimatedTime: 'Finalizado'
  });

  // Marcar como completado
  markProgressCompleted();

  // Auto-ocultar después de 10 segundos
  setTimeout(() => {
    hideProgressSection();
  }, 10000);
}