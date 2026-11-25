-- H8 (corrección de datos E1): platillos de comandas ya tomadas que quedaron en RECEIVED.
--
-- Antes de la corrección E1, KitchenService.take() cambiaba la comanda de
-- RECEIVED a IN_PREPARATION, pero no sus platillos. Esos platillos quedaron en
-- RECEIVED dentro de comandas IN_PREPARATION y no se pueden terminar, porque
-- markItemReady exige que el platillo esté en IN_PREPARATION.
--
-- Alcance exacto:
--   * Solo platillos en RECEIVED de comandas en IN_PREPARATION.
--   * No toca platillos CANCELLED, READY ni IN_PREPARATION.
--   * No toca comandas en otros estados (PENDING_PAYMENT, RECEIVED, READY,
--     DELIVERED, CANCELLED) ni modifica ninguna fila de "orders".
--
-- Idempotente: después de ejecutarse no quedan filas que cumplan la condición,
-- así que una segunda ejecución actualiza 0 filas. Es una sola sentencia y,
-- por lo tanto, atómica. No cambia el esquema.
UPDATE "order_items" AS i
SET "status" = 'IN_PREPARATION'
FROM "orders" AS o
WHERE i."order_id" = o."id"
  AND o."status" = 'IN_PREPARATION'
  AND i."status" = 'RECEIVED';
