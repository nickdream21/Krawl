const { contextBridge, ipcRenderer } = require('electron');

// Exponer funciones seguras al proceso de renderizado
contextBridge.exposeInMainWorld('electronAPI', {
  // Funciones para gestión documental (existentes)
  buscarDocumentos: (criterios) => ipcRenderer.invoke('buscar-documentos', criterios),
  abrirDocumento: (ruta) => ipcRenderer.invoke('abrir-documento', ruta),
  abrirEnCarpeta: (ruta) => ipcRenderer.invoke('abrir-en-carpeta', ruta),
  indexarCarpeta: () => ipcRenderer.invoke('indexar-carpeta'),
  sincronizarDrive: () => ipcRenderer.invoke('sincronizar-drive'),

  // NUEVAS FUNCIONES PARA CAMPO DE RUTA
  seleccionarCarpeta: () => ipcRenderer.invoke('seleccionar-carpeta'),
  indexarCarpetaEspecifica: (rutaCarpeta, filtros) => ipcRenderer.invoke('indexar-carpeta-especifica', { rutaCarpeta, filtros }),
  seleccionarArchivos: () => ipcRenderer.invoke('seleccionar-archivos'),
  indexarArchivosSeleccionados: (archivos, filtros) => ipcRenderer.invoke('indexar-archivos-seleccionados', { archivos, filtros }),

  // NUEVAS FUNCIONES PARA CONTROL DE INDEXACIÓN
  pausarIndexacion: () => ipcRenderer.invoke('pausar-indexacion'),
  reanudarIndexacion: () => ipcRenderer.invoke('reanudar-indexacion'),
  cancelarIndexacion: () => ipcRenderer.invoke('cancelar-indexacion'),

  // NUEVA FUNCIÓN PARA EDITAR ASUNTO
  actualizarAsuntoDocumento: (ruta, nuevoAsunto) => ipcRenderer.invoke('actualizar-asunto-documento', { ruta, nuevoAsunto }),

  // Funciones para detección y procesamiento de documentos nuevos
  verificarDocumentosNuevos: () => ipcRenderer.invoke('verificar-documentos-nuevos'),
  procesarDocumentoNuevo: (documento, asunto) =>
    ipcRenderer.invoke('procesar-documento-nuevo', { documento, asunto }),
  configurarVerificacionAutomatica: (activa) =>
    ipcRenderer.invoke('configurar-verificacion-automatica', { activa }),
  // Receptor de eventos para cuando se detecten documentos nuevos
  onDocumentosNuevosDetectados: (callback) => {
    // Almacenar la referencia para poder eliminarla
    const subscription = (event, documentos) => callback(documentos);
    ipcRenderer.on('documentos-nuevos-detectados', subscription);

    // Devolver una función para eliminar el listener cuando ya no sea necesario
    return () => {
      ipcRenderer.removeListener('documentos-nuevos-detectados', subscription);
    };
  },

  // NUEVO: Receptor de eventos para progreso de indexación
  onIndexacionProgreso: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('indexacion-progreso', subscription);

    return () => {
      ipcRenderer.removeListener('indexacion-progreso', subscription);
    };
  },

  // NUEVAS FUNCIONES PARA DESCARGA
  descargarDocumento: (ruta) => ipcRenderer.invoke('descargar-documento', ruta),
  descargarVariosDocumentos: (rutas) => ipcRenderer.invoke('descargar-varios-documentos', rutas),

  // FUNCIONES DE AUTO-ACTUALIZACIÓN
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: () => ipcRenderer.invoke('update-check'),
  downloadUpdate: () => ipcRenderer.invoke('update-download'),
  installUpdate: () => ipcRenderer.invoke('update-install'),

  onUpdateAvailable: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('update-available', subscription);
    return () => ipcRenderer.removeListener('update-available', subscription);
  },
  onUpdateProgress: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('update-download-progress', subscription);
    return () => ipcRenderer.removeListener('update-download-progress', subscription);
  },
  onUpdateDownloaded: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('update-downloaded', subscription);
    return () => ipcRenderer.removeListener('update-downloaded', subscription);
  },

  // ENTERPRISE
  enterpriseGetConfig: () => ipcRenderer.invoke('enterprise-get-config'),
  enterpriseSetConfig: (config) => ipcRenderer.invoke('enterprise-set-config', config),
  enterpriseSelectDbFolder: () => ipcRenderer.invoke('enterprise-select-db-folder'),
  enterpriseCreateDb: () => ipcRenderer.invoke('enterprise-create-db'),
  enterpriseDbStatus: () => ipcRenderer.invoke('enterprise-db-status'),
  onEnterpriseConfigNeeded: (callback) => {
    const sub = (event, data) => callback(data);
    ipcRenderer.on('enterprise-config-needed', sub);
    return () => ipcRenderer.removeListener('enterprise-config-needed', sub);
  },
  onEnterpriseDbStatus: (callback) => {
    const sub = (event, data) => callback(data);
    ipcRenderer.on('enterprise-db-status', sub);
    return () => ipcRenderer.removeListener('enterprise-db-status', sub);
  },
  onEnterpriseDbReloaded: (callback) => {
    const sub = (_event) => callback();
    ipcRenderer.on('enterprise-db-reloaded', sub);
    return () => ipcRenderer.removeListener('enterprise-db-reloaded', sub);
  }
});
