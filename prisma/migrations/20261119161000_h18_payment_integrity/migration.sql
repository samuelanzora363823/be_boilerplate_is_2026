-- Un pago debe pertenecer a una cuenta o a un pedido,
-- nunca a ambos ni a ninguno.
ALTER TABLE "payments"
ADD CONSTRAINT "payments_exactly_one_target"
CHECK (
    ("account_id" IS NOT NULL AND "order_id" IS NULL)
    OR
    ("account_id" IS NULL AND "order_id" IS NOT NULL)
);

-- Un comprobante debe pertenecer a una cuenta o a un pedido.
ALTER TABLE "receipts"
ADD CONSTRAINT "receipts_exactly_one_target"
CHECK (
    ("account_id" IS NOT NULL AND "order_id" IS NULL)
    OR
    ("account_id" IS NULL AND "order_id" IS NOT NULL)
);

-- Una cuenta solo puede tener un pago aprobado.
CREATE UNIQUE INDEX "payments_one_approved_per_account"
ON "payments" ("account_id")
WHERE "status" = 'APPROVED' AND "account_id" IS NOT NULL;

-- Un pedido solo puede tener un pago aprobado.
CREATE UNIQUE INDEX "payments_one_approved_per_order"
ON "payments" ("order_id")
WHERE "status" = 'APPROVED' AND "order_id" IS NOT NULL;
