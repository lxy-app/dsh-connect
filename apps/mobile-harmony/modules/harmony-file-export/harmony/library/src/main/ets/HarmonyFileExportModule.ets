import {
  ExpoModule,
  ExpoModuleContext,
  ExpoModuleDefinition,
} from '@expo-harmony/expo-modules-core';
import picker from '@ohos.file.picker';
import fs from '@ohos.file.fs';
import { BusinessError } from '@kit.BasicServicesKit';

function errorMessage(cause: Object): string {
  try {
    const error = cause as BusinessError;
    if (typeof error.message === 'string' && error.message.length > 0) {
      return error.code === undefined ? error.message : `${error.message} (${error.code})`;
    }
    return String(cause);
  } catch (_) {
    return 'Unknown HarmonyOS file export error.';
  }
}

function sanitizedFileName(suggestedName: string): string {
  const cleaned = suggestedName.replace(/[\\/\u0000-\u001f\u007f-\u009f]/g, '').trim();
  return cleaned.length === 0 || cleaned === '.' || cleaned === '..' ? 'attachment' : cleaned;
}

export class HarmonyFileExportModule extends ExpoModule {
  constructor(context: ExpoModuleContext) {
    super(context);
  }

  override definition(): ExpoModuleDefinition {
    return new ExpoModuleDefinition()
      .name('HarmonyFileExport')
      .constant('platform', 'harmony')
      .asyncFunction(
        'save',
        async (sourceUri: string, suggestedName: string): Promise<string> =>
          this.saveInternal(sourceUri, suggestedName),
      );
  }

  private async saveInternal(sourceUri: string, suggestedName: string): Promise<string> {
    if (!sourceUri.startsWith('file://')) {
      throw new Error('只能保存已经下载到本机缓存的附件。');
    }

    const documentPicker = new picker.DocumentViewPicker(this.context.uiAbilityContext);
    const options = new picker.DocumentSaveOptions();
    options.newFileNames = [sanitizedFileName(suggestedName)];

    let destinationUris: Array<string>;
    try {
      destinationUris = await documentPicker.save(options);
    } catch (cause) {
      throw new Error(`无法打开系统保存位置选择器：${errorMessage(cause as Object)}`);
    }
    if (destinationUris.length === 0 || destinationUris[0].length === 0) return 'cancelled';

    try {
      await this.copyAndVerify(sourceUri, destinationUris[0]);
    } catch (cause) {
      throw new Error(`附件未能完整保存到所选位置：${errorMessage(cause as Object)}`);
    }
    return 'saved';
  }

  private async copyAndVerify(sourceUri: string, destinationUri: string): Promise<void> {
    let sourceFile: fs.File | undefined = undefined;
    let destinationFile: fs.File | undefined = undefined;
    try {
      sourceFile = await fs.open(sourceUri, fs.OpenMode.READ_ONLY);
      const sourceSize = (await fs.stat(sourceFile.fd)).size;
      await fs.copy(sourceUri, destinationUri);
      destinationFile = await fs.open(destinationUri, fs.OpenMode.READ_ONLY);
      const destinationSize = (await fs.stat(destinationFile.fd)).size;
      if (destinationSize !== sourceSize) {
        throw new Error(`Saved byte count ${destinationSize} does not match source byte count ${sourceSize}.`);
      }
    } finally {
      if (destinationFile !== undefined) await fs.close(destinationFile);
      if (sourceFile !== undefined) await fs.close(sourceFile);
    }
  }
}
