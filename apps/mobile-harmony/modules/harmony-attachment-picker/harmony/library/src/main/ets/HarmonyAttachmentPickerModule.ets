import {
  ExpoFunction,
  ExpoModule,
  ExpoModuleContext,
  ExpoModuleDefinition,
  ExpoValueTypes,
  fileUriFromPath,
} from '@expo-harmony/expo-modules-core';
import picker from '@ohos.file.picker';
import photoAccessHelper from '@ohos.file.photoAccessHelper';
import dataSharePredicates from '@ohos.data.dataSharePredicates';
import fs from '@ohos.file.fs';
import fileUri from '@ohos.file.fileuri';
import util from '@ohos.util';
import camera from '@ohos.multimedia.camera';
import cameraPicker from '@ohos.multimedia.cameraPicker';
import uniformTypeDescriptor from '@ohos.data.uniformTypeDescriptor';
import { BusinessError } from '@kit.BasicServicesKit';

const MAX_SELECT_NUMBER: number = 6;
const MAX_ATTACHMENT_BYTES: number = 20 * 1024 * 1024;
const CANCELLED_RESULT: string = '{"status":"cancelled","assets":[]}';

interface PickedAsset {
  kind: string;
  name: string;
  mime: string;
  bytes: number;
  uri: string;
}

interface SourceAsset {
  kind: string;
  name: string;
  mime: string;
  uri: string;
}

interface PickResult {
  status: string;
  assets: PickedAsset[];
}

interface CacheTarget {
  path: string;
  uri: string;
}

interface CachedFile {
  path: string;
  bytes: number;
  uri: string;
}

function errorMessage(cause: Object): string {
  try {
    const error = cause as BusinessError;
    if (typeof error.message === 'string' && error.message.length > 0) {
      return error.code === undefined ? error.message : `${error.message} (${error.code})`;
    }
    return String(cause);
  } catch (_) {
    return 'Unknown HarmonyOS attachment picker error.';
  }
}

function encodePicked(assets: PickedAsset[]): string {
  const result: PickResult = { status: 'picked', assets };
  return JSON.stringify(result);
}

function safeExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return '';
  const extension = name.slice(dot).toLowerCase();
  return /^\.[a-z0-9]{1,16}$/.test(extension) ? extension : '';
}

function mimeForName(name: string, kind: string): string {
  const extension = safeExtension(name);
  if (extension.length > 1) {
    try {
      const typeId = uniformTypeDescriptor.getUniformDataTypeByFilenameExtension(extension);
      const descriptor = uniformTypeDescriptor.getTypeDescriptor(typeId);
      if (descriptor.mimeTypes.length > 0 && descriptor.mimeTypes[0].length > 0) {
        return descriptor.mimeTypes[0];
      }
    } catch (_) {}
  }
  return 'application/octet-stream';
}

export class HarmonyAttachmentPickerModule extends ExpoModule {
  constructor(context: ExpoModuleContext) {
    super(context);
  }

  override definition(): ExpoModuleDefinition {
    return new ExpoModuleDefinition()
      .name('HarmonyAttachmentPicker')
      .constant('platform', 'harmony')
      .asyncFunction(
        'pick',
        ExpoFunction.typed2(
          ExpoValueTypes.string(),
          ExpoValueTypes.number(),
          async (source: string, remainingSlots: number): Promise<string> =>
            this.pickInternal(source, remainingSlots),
        ),
      );
  }

  private async pickInternal(source: string, remainingSlots: number): Promise<string> {
    if (!Number.isInteger(remainingSlots) || remainingSlots <= 0 || remainingSlots > MAX_SELECT_NUMBER) {
      throw new Error(`附件选择数量必须是 1 到 ${MAX_SELECT_NUMBER} 的整数。`);
    }
    if (source === 'camera') return this.pickCamera();
    if (source === 'library') return this.pickLibrary(remainingSlots);
    if (source === 'document') return this.pickDocuments(remainingSlots);
    throw new Error('无法识别的附件选择来源。');
  }

  private async pickCamera(): Promise<string> {
    let target: CacheTarget | undefined = undefined;
    try {
      target = await this.prepareCacheFile('camera.jpg');
      // Some HarmonyOS runtimes expose PickerProfile fields as read-only after construction.
      const profile: cameraPicker.PickerProfile = {
        cameraPosition: camera.CameraPosition.CAMERA_POSITION_BACK,
        saveUri: target.uri,
      };
      const result = await cameraPicker.pick(
        this.context.uiAbilityContext,
        [cameraPicker.PickerMediaType.PHOTO],
        profile,
      );
      if (result.resultCode !== 0 || result.resultUri.length === 0) {
        await this.discardCacheFile(target.path);
        return CANCELLED_RESULT;
      }

      const bytes = await this.readFileSize(target.uri);
      if (bytes <= 0) throw new Error('系统相机未写入有效的图片文件。');
      if (bytes > MAX_ATTACHMENT_BYTES) throw new Error('拍摄图片超过 20.0 MB 上限。');
      const asset: PickedAsset = {
        kind: 'image',
        name: `拍摄-${Date.now()}.jpg`,
        mime: 'image/jpeg',
        bytes,
        uri: fileUriFromPath(target.path),
      };
      return encodePicked([asset]);
    } catch (cause) {
      if (target !== undefined) await this.discardCacheFile(target.path);
      throw new Error(`拍照或读取照片失败：${errorMessage(cause as Object)}`);
    }
  }

  private async pickLibrary(remainingSlots: number): Promise<string> {
    const photoPicker = new photoAccessHelper.PhotoViewPicker();
    const options = new photoAccessHelper.PhotoSelectOptions();
    options.MIMEType = photoAccessHelper.PhotoViewMIMETypes.IMAGE_TYPE;
    options.maxSelectNumber = remainingSlots;

    let selection: photoAccessHelper.PhotoSelectResult;
    try {
      selection = await photoPicker.select(options);
    } catch (cause) {
      throw new Error(`无法打开系统照片选择器：${errorMessage(cause as Object)}`);
    }
    if (selection.photoUris.length === 0) return CANCELLED_RESULT;

    const accessHelper = photoAccessHelper.getPhotoAccessHelper(this.context.uiAbilityContext);
    const assets: PickedAsset[] = [];
    const cachePaths: string[] = [];
    try {
      try {
        for (const selectedUri of selection.photoUris) {
          try {
            const source = await this.readPhotoAsset(accessHelper, selectedUri);
            const cached = await this.copyToCache(source.uri, source.name);
            cachePaths.push(cached.path);
            assets.push({
              kind: source.kind,
              name: source.name,
              mime: source.mime,
              bytes: cached.bytes,
              uri: cached.uri,
            });
          } catch (cause) {
            throw new Error(`所选图片未能复制到应用缓存：${errorMessage(cause as Object)}`);
          }
        }
      } finally {
        try {
          await accessHelper.release();
        } catch (cause) {
          throw new Error(`释放照片访问资源失败：${errorMessage(cause as Object)}`);
        }
      }
    } catch (cause) {
      await this.discardCacheFiles(cachePaths);
      throw new Error(errorMessage(cause as Object));
    }
    return encodePicked(assets);
  }

  private async readPhotoAsset(
    accessHelper: photoAccessHelper.PhotoAccessHelper,
    selectedUri: string,
  ): Promise<SourceAsset> {
    const predicates = new dataSharePredicates.DataSharePredicates();
    predicates.equalTo(photoAccessHelper.PhotoKeys.URI, selectedUri);
    const options: photoAccessHelper.FetchOptions = {
      fetchColumns: [
        photoAccessHelper.PhotoKeys.URI,
        photoAccessHelper.PhotoKeys.DISPLAY_NAME,
        photoAccessHelper.PhotoKeys.PHOTO_TYPE,
      ],
      predicates,
    };

    let fetchResult: photoAccessHelper.FetchResult<photoAccessHelper.PhotoAsset> | undefined = undefined;
    try {
      fetchResult = await accessHelper.getAssets(options);
      if (fetchResult.getCount() === 0) throw new Error('系统未返回所选图片的临时读取授权。');
      const asset = await fetchResult.getFirstObject();
      const displayName = asset.get(photoAccessHelper.PhotoKeys.DISPLAY_NAME);
      const mediaType = asset.get(photoAccessHelper.PhotoKeys.PHOTO_TYPE);
      const kind = mediaType === photoAccessHelper.PhotoType.IMAGE ? 'image' : 'file';
      const name = typeof displayName === 'string' && displayName.length > 0
        ? displayName
        : `图片-${Date.now()}.jpg`;
      return { kind, name, mime: mimeForName(name, kind), uri: asset.uri };
    } finally {
      if (fetchResult !== undefined) fetchResult.close();
    }
  }

  private async pickDocuments(remainingSlots: number): Promise<string> {
    const documentPicker = new picker.DocumentViewPicker(this.context.uiAbilityContext);
    const options = new picker.DocumentSelectOptions();
    options.maxSelectNumber = remainingSlots;

    let selectedUris: string[];
    try {
      selectedUris = await documentPicker.select(options);
    } catch (cause) {
      throw new Error(`无法打开系统文件选择器：${errorMessage(cause as Object)}`);
    }
    if (selectedUris.length === 0) return CANCELLED_RESULT;

    const assets: PickedAsset[] = [];
    const cachePaths: string[] = [];
    try {
      for (const selectedUri of selectedUris) {
        try {
          const name = new fileUri.FileUri(selectedUri).name;
          const source: SourceAsset = {
            kind: 'file',
            name: name.length > 0 ? name : `附件-${Date.now()}`,
            mime: mimeForName(name, 'file'),
            uri: selectedUri,
          };
          const cached = await this.copyToCache(source.uri, source.name);
          cachePaths.push(cached.path);
          assets.push({
            kind: source.kind,
            name: source.name,
            mime: source.mime,
            bytes: cached.bytes,
            uri: cached.uri,
          });
        } catch (cause) {
          throw new Error(`所选文件未能复制到应用缓存：${errorMessage(cause as Object)}`);
        }
      }
    } catch (cause) {
      await this.discardCacheFiles(cachePaths);
      throw new Error(errorMessage(cause as Object));
    }
    return encodePicked(assets);
  }

  private async copyToCache(sourceUri: string, sourceName: string): Promise<CachedFile> {
    const sourceBytes = await this.readFileSize(sourceUri);
    if (sourceBytes > MAX_ATTACHMENT_BYTES) throw new Error(`${sourceName} 超过 20.0 MB 上限。`);
    const target = await this.prepareCacheFile(sourceName);
    try {
      await fs.copy(sourceUri, target.uri);
      const copiedBytes = await this.readFileSize(target.uri);
      if (copiedBytes !== sourceBytes) {
        throw new Error(`缓存字节数 ${copiedBytes} 与源文件字节数 ${sourceBytes} 不一致。`);
      }
      return { path: target.path, bytes: copiedBytes, uri: fileUriFromPath(target.path) };
    } catch (cause) {
      await this.discardCacheFile(target.path);
      throw new Error(errorMessage(cause as Object));
    }
  }

  private async prepareCacheFile(sourceName: string): Promise<CacheTarget> {
    const directory = `${this.context.uiAbilityContext.cacheDir}/attachment-picks`;
    if (!(await fs.access(directory))) await fs.mkdir(directory, true);
    const path = `${directory}/${util.generateRandomUUID()}${safeExtension(sourceName)}`;
    let file: fs.File | undefined = undefined;
    try {
      file = await fs.open(path, fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
    } finally {
      if (file !== undefined) await fs.close(file);
    }
    return { path, uri: fileUri.getUriFromPath(path) };
  }

  private async readFileSize(uri: string): Promise<number> {
    let file: fs.File | undefined = undefined;
    try {
      file = await fs.open(uri, fs.OpenMode.READ_ONLY);
      return (await fs.stat(file.fd)).size;
    } finally {
      if (file !== undefined) await fs.close(file);
    }
  }

  private async discardCacheFiles(paths: string[]): Promise<void> {
    for (const path of paths) await this.discardCacheFile(path);
  }

  private async discardCacheFile(path: string): Promise<void> {
    try {
      if (await fs.access(path)) await fs.unlink(path);
    } catch (_) {}
  }
}
