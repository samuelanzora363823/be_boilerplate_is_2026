import { BadRequestException } from '@nestjs/common';

// Reglas comunes de los reportes (Épica 10): período en la zona horaria
// de El Salvador (UTC-6, sin horario de verano), fechas inicial y final
// incluidas, inicial no posterior a la final, final no posterior a hoy
// y rango de máximo 366 días.
export const OFFSET_HORAS = 6;
const DIA_MS = 24 * 60 * 60 * 1000;
const MAX_DIAS = 366;

export type Periodo = {
  from: string;
  to: string;
  // Límites en UTC: desde (incluido) y hasta (excluido).
  desde: Date;
  hasta: Date;
};

function fail(message: string, field: string): never {
  throw new BadRequestException({ message, field });
}

function parseFecha(valor: string | undefined, campo: 'from' | 'to'): Date {
  const nombre = campo === 'from' ? 'La fecha inicial' : 'La fecha final';
  if (!valor) fail(`${nombre} es obligatoria.`, campo);
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  const fecha = partes
    ? new Date(Date.UTC(+partes[1], +partes[2] - 1, +partes[3]))
    : null;
  if (!fecha || fecha.toISOString().slice(0, 10) !== valor) {
    fail(`${nombre} debe tener el formato aaaa-mm-dd.`, campo);
  }
  return fecha;
}

// Fecha de hoy en El Salvador, como medianoche UTC del mismo día.
export function hoyElSalvador(ahora = new Date()): Date {
  const local = new Date(ahora.getTime() - OFFSET_HORAS * 60 * 60 * 1000);
  return new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()),
  );
}

export function validarPeriodo(
  from: string | undefined,
  to: string | undefined,
  ahora = new Date(),
): Periodo {
  const inicio = parseFecha(from, 'from');
  const fin = parseFecha(to, 'to');

  if (inicio > fin) {
    fail('La fecha inicial no puede ser posterior a la fecha final.', 'from');
  }
  if (fin > hoyElSalvador(ahora)) {
    fail('La fecha final no puede ser posterior a hoy.', 'to');
  }
  if ((fin.getTime() - inicio.getTime()) / DIA_MS + 1 > MAX_DIAS) {
    fail('El período no puede superar 366 días.', 'to');
  }

  const offset = OFFSET_HORAS * 60 * 60 * 1000;
  return {
    from: from as string,
    to: to as string,
    desde: new Date(inicio.getTime() + offset),
    hasta: new Date(fin.getTime() + DIA_MS + offset),
  };
}
