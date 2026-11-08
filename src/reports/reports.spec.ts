import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { armarBloques, horasDeAtencion } from './peak-hours.js';
import { hoyElSalvador, validarPeriodo } from './period.js';

// 8/11/2026 10:00 en El Salvador (16:00 UTC).
const ahora = new Date('2026-11-08T16:00:00Z');

function errorDe(fn: () => unknown) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    return (e as BadRequestException).getResponse() as { message: string; field: string };
  }
  throw new Error('No lanzó error');
}

describe('validarPeriodo (reglas comunes de los reportes)', () => {
  it('convierte el período a límites UTC con UTC-6 e incluye ambos días', () => {
    const p = validarPeriodo('2026-11-01', '2026-11-08', ahora);
    expect(p.desde.toISOString()).toBe('2026-11-01T06:00:00.000Z');
    expect(p.hasta.toISOString()).toBe('2026-11-09T06:00:00.000Z');
  });

  it('usa la fecha de El Salvador para "hoy"', () => {
    expect(hoyElSalvador(new Date('2026-11-09T05:59:00Z')).toISOString()).toBe('2026-11-08T00:00:00.000Z');
  });

  it.each([
    [undefined, '2026-11-08', 'La fecha inicial es obligatoria.', 'from'],
    ['2026-11-01', undefined, 'La fecha final es obligatoria.', 'to'],
    ['01/11/2026', '2026-11-08', 'La fecha inicial debe tener el formato aaaa-mm-dd.', 'from'],
    ['2026-02-30', '2026-11-08', 'La fecha inicial debe tener el formato aaaa-mm-dd.', 'from'],
    ['2026-11-08', '2026-11-01', 'La fecha inicial no puede ser posterior a la fecha final.', 'from'],
    ['2026-11-01', '2026-11-09', 'La fecha final no puede ser posterior a hoy.', 'to'],
    ['2025-11-07', '2026-11-08', 'El período no puede superar 366 días.', 'to'],
  ])('rechaza %s – %s', (from, to, message, field) => {
    expect(errorDe(() => validarPeriodo(from, to, ahora))).toEqual({ message, field });
  });

  it('acepta exactamente 366 días', () => {
    expect(() => validarPeriodo('2025-11-08', '2026-11-08', ahora)).not.toThrow();
  });
});

describe('bloques de horarios pico (H29)', () => {
  it('divide 07:00 a 22:00 en bloques de 7 a 21', () => {
    const horas = horasDeAtencion('07:00', '22:00');
    expect(horas[0]).toBe(7);
    expect(horas.at(-1)).toBe(21);
    expect(horas).toHaveLength(15);
  });

  it('completa con 0, marca 3 horas pico y desempata por la más temprana', () => {
    const bloques = armarBloques('07:00', '22:00', new Map([[12, 5], [13, 5], [19, 5], [20, 2]]));
    expect(bloques.find((b) => b.hour === 8)).toEqual({ hour: 8, label: '08:00–08:59', orderCount: 0, isPeak: false });
    expect(bloques.filter((b) => b.isPeak).map((b) => b.hour)).toEqual([12, 13, 19]);
  });

  it('no marca como hora pico bloques con 0 pedidos', () => {
    const bloques = armarBloques('07:00', '22:00', new Map([[9, 1]]));
    expect(bloques.filter((b) => b.isPeak).map((b) => b.hour)).toEqual([9]);
  });

  it('muestra también un pedido fuera del horario', () => {
    const bloques = armarBloques('07:00', '22:00', new Map([[23, 1]]));
    expect(bloques.at(-1)).toMatchObject({ hour: 23, orderCount: 1 });
  });
});
