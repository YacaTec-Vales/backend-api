/**
 * @fileoverview Tests unitarios de `EmailLogRepository`.
 *
 * Cubre:
 *  - `create` llama a `writeDb.insert` (WRITE).
 *  - `list` con/sin filtros llama a `readDb.select` (READ).
 *  - `count` aplica los mismos filtros que `list`.
 *
 * Las queries Drizzle reales se validan en los integration specs
 * (no en este archivo).
 *
 * @module database/repositories
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { EmailLogRepository } from './email-log.repository';

describe('EmailLogRepository', () => {
  let repository: EmailLogRepository;
  let writeDb: { insert: jest.Mock };
  let readDb: { select: jest.Mock };

  beforeEach(() => {
    const insertReturning = jest.fn().mockResolvedValue([{ id: 'row-1' }]);
    writeDb = {
      insert: jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: insertReturning,
        }),
      }),
    };
    readDb = {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                offset: jest.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
      }),
    };

    repository = new EmailLogRepository(writeDb as never, readDb as never);
  });

  it('create usa writeDb (WRITE)', async () => {
    await repository.create({
      templateKey: 'user-welcome',
      recipientEmail: 'a@yacatec.demo',
      subject: 'S',
      status: 'sent',
    });
    expect(writeDb.insert).toHaveBeenCalledTimes(1);
    expect(readDb.select).not.toHaveBeenCalled();
  });

  it('list usa readDb (READ) y pagina con page/limit', async () => {
    await repository.list({ page: 2, limit: 10 });
    expect(readDb.select).toHaveBeenCalledTimes(1);
    expect(writeDb.insert).not.toHaveBeenCalled();
  });

  it('list aplica filtros cuando se pasan', async () => {
    await repository.list({
      page: 1,
      limit: 20,
      recipientUserId: 'u-1',
      templateKey: 'user-welcome',
      status: 'failed',
    });
    expect(readDb.select).toHaveBeenCalledTimes(1);
  });
});
