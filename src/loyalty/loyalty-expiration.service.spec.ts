import { LoyaltyExpirationService } from './loyalty-expiration.service.js';

describe('LoyaltyExpirationService', () => {
  it('procesa candidatos vencidos usando la liberación transaccional del repositorio', async () => {
    const repository = {
      findExpiredRedemptionCandidates: vi
        .fn()
        .mockResolvedValue([{ id: 'expired-1' }, { id: 'expired-2' }]),
      releaseExpiredRedemptionById: vi
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
    };
    const service = new LoyaltyExpirationService(repository as never);

    await expect(service.releaseExpiredBatch()).resolves.toBe(1);
    expect(repository.findExpiredRedemptionCandidates).toHaveBeenCalledOnce();
    expect(repository.releaseExpiredRedemptionById).toHaveBeenCalledTimes(2);
    expect(repository.releaseExpiredRedemptionById).toHaveBeenNthCalledWith(
      1,
      'expired-1',
      expect.any(Date),
    );
  });

  it('evita ciclos superpuestos dentro de una instancia', async () => {
    let finish!: (value: Array<{ id: string }>) => void;
    const repository = {
      findExpiredRedemptionCandidates: vi.fn(
        () => new Promise<Array<{ id: string }>>((resolve) => { finish = resolve; }),
      ),
      releaseExpiredRedemptionById: vi.fn().mockResolvedValue(true),
    };
    const service = new LoyaltyExpirationService(repository as never);

    const first = service.releaseExpiredBatch();
    await expect(service.releaseExpiredBatch()).resolves.toBe(0);
    finish([{ id: 'expired-1' }]);
    await expect(first).resolves.toBe(1);
    expect(repository.findExpiredRedemptionCandidates).toHaveBeenCalledOnce();
  });
});
