// Отметка сборки: нужна, чтобы по экрану входа было видно, какая версия
// фронтенда реально загружена в браузере (кеш превью — частая причина
// «исправили, а поведение прежнее»).
export const BUILD_STAMP: string =
  typeof __BUILD_STAMP__ === "string" ? __BUILD_STAMP__ : "dev";

export const APP_VERSION = "2.1";
