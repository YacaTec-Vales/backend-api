/**
 * @fileoverview Tests unitarios del helper `parseArgs`/`requireArgs`.
 */

import { parseArgs, requireArgs, SeedCliError } from './seed-helpers';

describe('seed-helpers.parseArgs', () => {
  it('parsea flags --key=value', () => {
    expect(parseArgs(['--email=a@b.com', '--firstName=Juan'])).toEqual({
      '--email': 'a@b.com',
      '--firstName': 'Juan',
    });
  });

  it('parsea flags --key value (con espacio)', () => {
    expect(parseArgs(['--email', 'a@b.com', '--firstName', 'Juan'])).toEqual({
      '--email': 'a@b.com',
      '--firstName': 'Juan',
    });
  });

  it('parsea flags booleanos --flag', () => {
    expect(parseArgs(['--force', '--email=a@b.com'])).toEqual({
      '--force': true,
      '--email': 'a@b.com',
    });
  });

  it('ignora argumentos que no empiezan con --', () => {
    expect(parseArgs(['positional', '--email=a@b.com'])).toEqual({
      '--email': 'a@b.com',
    });
  });
});

describe('seed-helpers.requireArgs', () => {
  it('devuelve los args cuando todos los required estan presentes', () => {
    const args = { '--email': 'a@b.com', '--firstName': 'Ana' };
    expect(
      requireArgs(args as never, { required: ['email', 'firstName'] }),
    ).toBe(args);
  });

  it('lanza SeedCliError cuando falta un required', () => {
    const args = { '--email': 'a@b.com' };
    expect(() =>
      requireArgs(args as never, { required: ['email', 'firstName'] }),
    ).toThrow(SeedCliError);
  });
});
