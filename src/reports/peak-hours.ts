// Bloques de 1 hora del horario de atención (H29).

export type BloqueHora = {
  hour: number;
  label: string;
  orderCount: number;
  isPeak: boolean;
};

const dos = (n: number) => String(n).padStart(2, '0');

export function etiqueta(hour: number) {
  return `${dos(hour)}:00–${dos(hour)}:59`;
}

function minutos(hora: string) {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + (m || 0);
}

// Horas que cubre el horario de atención, por ejemplo 07:00 a 22:00
// da los bloques 7 a 21. Si la sucursal cierra después de medianoche,
// el horario continúa desde las 0 horas.
export function horasDeAtencion(apertura: string, cierre: string): number[] {
  const inicio = minutos(apertura);
  let fin = minutos(cierre);
  if (fin <= inicio) fin += 24 * 60;
  const horas: number[] = [];
  for (let h = Math.floor(inicio / 60); h * 60 < fin; h++) horas.push(h % 24);
  return horas;
}

// Completa con 0 las horas sin pedidos y marca como hora pico los
// 3 bloques con más pedidos (mayores a 0); en empate, el más temprano.
export function armarBloques(
  apertura: string,
  cierre: string,
  conteos: Map<number, number>,
): BloqueHora[] {
  const horas = horasDeAtencion(apertura, cierre);
  // Un pedido fuera del horario también se muestra, para que la suma
  // de los bloques coincida con el total de pedidos.
  for (const hora of conteos.keys()) if (!horas.includes(hora)) horas.push(hora);
  horas.sort((a, b) => a - b);

  const pico = new Set(
    horas
      .filter((h) => (conteos.get(h) ?? 0) > 0)
      .sort((a, b) => (conteos.get(b) ?? 0) - (conteos.get(a) ?? 0) || a - b)
      .slice(0, 3),
  );

  return horas.map((hour) => ({
    hour,
    label: etiqueta(hour),
    orderCount: conteos.get(hour) ?? 0,
    isPeak: pico.has(hour),
  }));
}
