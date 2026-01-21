// Minimal ambient types for the Barcode Detector API to satisfy TypeScript.
// This does not change runtime behavior; it only informs the type system.

type SupportedBarcodeFormat =
  | 'aztec'
  | 'code_128'
  | 'code_39'
  | 'code_93'
  | 'codabar'
  | 'data_matrix'
  | 'ean_13'
  | 'ean_8'
  | 'itf'
  | 'pdf417'
  | 'qr_code'
  | 'upc_a'
  | 'upc_e';

interface BarcodeDetectorOptions {
  formats?: SupportedBarcodeFormat[];
}

interface DetectedBarcode {
  rawValue: string;
}

interface BarcodeDetectorConstructor {
  new (options?: BarcodeDetectorOptions): BarcodeDetectorInstance;
}

interface BarcodeDetectorInstance {
  detect(image: HTMLCanvasElement | HTMLVideoElement | ImageBitmap | ImageData): Promise<DetectedBarcode[]>;
}

declare global {
  interface Window {
    BarcodeDetector?: BarcodeDetectorConstructor;
  }

  const BarcodeDetector: BarcodeDetectorConstructor | undefined;
}

export {};
