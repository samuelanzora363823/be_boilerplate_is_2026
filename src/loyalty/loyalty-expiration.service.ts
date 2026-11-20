import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { LoyaltyRepository } from './loyalty.repository.js';

const EXPIRATION_INTERVAL_MS = 60_000;
const EXPIRATION_BATCH_SIZE = 100;

@Injectable()
export class LoyaltyExpirationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LoyaltyExpirationService.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(private readonly loyaltyRepository: LoyaltyRepository) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.releaseExpiredBatch();
    }, EXPIRATION_INTERVAL_MS);
    this.timer.unref();
    void this.releaseExpiredBatch();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async releaseExpiredBatch(): Promise<number> {
    if (this.running) return 0;
    this.running = true;

    let releasedCount = 0;
    try {
      const candidates = await this.loyaltyRepository.findExpiredRedemptionCandidates(
        new Date(),
        EXPIRATION_BATCH_SIZE,
      );

      for (const candidate of candidates) {
        try {
          if (
            await this.loyaltyRepository.releaseExpiredRedemptionById(
              candidate.id,
              new Date(),
            )
          ) {
            releasedCount += 1;
          }
        } catch (error) {
          this.logger.error(
            `No se pudo liberar la reserva vencida ${candidate.id}`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      }
    } catch (error) {
      this.logger.error(
        'Falló la búsqueda de reservas H21 vencidas',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.running = false;
    }

    return releasedCount;
  }
}
