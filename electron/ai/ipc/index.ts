/**
 * ipc/index.ts
 *
 * Public entry point for the IPC layer.
 * Import this in the Electron main process to register all AI handlers.
 *
 * Example usage in electron/main.ts:
 *
 *   import { AiContainer, AiIpcHandlers } from './ai/ipc';
 *
 *   app.whenReady().then(async () => {
 *     const storageRoot = path.join(app.getPath('userData'), 'vyrix-projects');
 *     const container   = await AiContainer.create({
 *       storageRoot,
 *       llamaBinary: path.join(app.getAppPath(), 'bin/llama-server'),
 *       modelPath:   path.join(app.getPath('userData'), 'models/qwen2.5-vl-7b-q4_k_m.gguf'),
 *     });
 *
 *     const handlers = new AiIpcHandlers(ipcMain, container);
 *     handlers.register();
 *
 *     app.on('before-quit', () => container.dispose());
 *   });
 */

export { AiContainer }    from "./AiContainer";
export { AiIpcHandlers }  from "./AiIpcHandlers";
export type { AiContainerOptions } from "./AiContainer";
