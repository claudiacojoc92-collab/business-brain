import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';

let sdk: NodeSDK | null = null;

/**
 * Initialises the OpenTelemetry SDK.
 * Must be called before any other imports to ensure instrumentation works.
 * Source: Implementation Spec V1 Section 07.
 */
export function initTelemetry(otlpEndpoint: string): void {
  sdk = new NodeSDK({
    traceExporter:    new OTLPTraceExporter({ url: otlpEndpoint }),
    instrumentations: [getNodeAutoInstrumentations()],
  });
  sdk.start();
}

export async function shutdownTelemetry(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
    sdk = null;
  }
}
