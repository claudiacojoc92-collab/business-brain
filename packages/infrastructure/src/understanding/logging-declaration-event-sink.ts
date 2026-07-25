import type { DeclarationAppendedEvent, DeclarationEventSink } from '@bb/application';
import type { Logger } from '../telemetry/logger';

/** Structured declaration event sink — ids / kind / replay only. NEVER the founder-authored statement text. */
export class LoggingDeclarationEventSink implements DeclarationEventSink {
  constructor(private readonly logger: Logger) {}

  declarationAppended(event: DeclarationAppendedEvent): void {
    this.logger.info(
      {
        event: 'declaration.appended',
        business: `${event.businessRef.type}:${event.businessRef.id}`,
        declarationId: event.declarationId,
        kind: event.kind,
        replayed: event.replayed,
      },
      'declaration.appended',
    );
  }
}
