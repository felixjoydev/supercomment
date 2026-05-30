export {
  serializeDocument,
  collectStylesheets,
  rewriteCssUrls,
  rewriteSrcset,
} from './serialize';
export type { SerializeOptions, SerializeResult } from './serialize';

export {
  captureSnapshot,
  startSnapshotCapture,
  DEFAULT_MAX_BYTES,
} from './capture';
export type {
  CaptureSnapshotOptions,
  StartSnapshotCaptureConfig,
  SnapshotCaptureHandle,
  SnapshotSink,
  SpaWindow,
} from './capture';

export {
  redactSecrets,
  containsSecret,
  maskFieldAttributes,
  SECRET_PATTERNS,
  REDACTION_PLACEHOLDER,
  MASKED_VALUE,
} from './mask';
export type { SecretPattern, MaskFieldInput } from './mask';
