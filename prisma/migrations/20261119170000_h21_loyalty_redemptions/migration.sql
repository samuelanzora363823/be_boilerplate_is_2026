-- H21 requires the existing H20, H18 and order tables.
-- The H22 benefit FK is intentionally deferred: loyalty_benefits has no
-- migration in this branch. The H22 migration must add that FK after creating
-- loyalty_benefits; do not apply an H21 SQL file that references it first.

CREATE TYPE "LoyaltyRedemptionStatus" AS ENUM ('RESERVED', 'COMPLETED', 'RELEASED');
CREATE TYPE "LoyaltyRedemptionReleaseReason" AS ENUM ('PAYMENT_REJECTED', 'CANCELLED', 'EXPIRED');
CREATE TYPE "LoyaltyRedemptionMovementType" AS ENUM ('RESERVED', 'SPENT', 'RELEASED');

ALTER TABLE "loyalty_accounts"
ADD COLUMN "reserved_points" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "loyalty_accounts"
ADD CONSTRAINT "loyalty_accounts_reserved_points_check"
CHECK ("reserved_points" >= 0 AND "reserved_points" <= "balance");

CREATE TABLE "loyalty_redemptions" (
    "id" UUID NOT NULL,
    "loyalty_account_id" UUID NOT NULL,
    "benefit_id" UUID NOT NULL,
    "account_id" UUID,
    "order_id" UUID,
    "payment_id" UUID,
    "points_reserved" INTEGER NOT NULL,
    "subtotal_amount" DECIMAL(10,2) NOT NULL,
    "discount_amount" DECIMAL(10,2) NOT NULL,
    "status" "LoyaltyRedemptionStatus" NOT NULL DEFAULT 'RESERVED',
    "release_reason" "LoyaltyRedemptionReleaseReason",
    "expires_at" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '15 minutes'),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "released_at" TIMESTAMP(3),

    CONSTRAINT "loyalty_redemptions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "loyalty_redemptions_exactly_one_purchase_check"
        CHECK (("account_id" IS NOT NULL) <> ("order_id" IS NOT NULL)),
    CONSTRAINT "loyalty_redemptions_points_check"
        CHECK ("points_reserved" > 0),
    CONSTRAINT "loyalty_redemptions_discount_check"
        CHECK ("subtotal_amount" >= 0 AND "discount_amount" >= 0 AND "discount_amount" <= "subtotal_amount"),
    CONSTRAINT "loyalty_redemptions_expiration_check"
        CHECK ("expires_at" = "created_at" + INTERVAL '15 minutes'),
    CONSTRAINT "loyalty_redemptions_state_timestamps_check"
        CHECK (
            ("status" = 'RESERVED' AND "completed_at" IS NULL AND "released_at" IS NULL AND "release_reason" IS NULL)
            OR ("status" = 'COMPLETED' AND "completed_at" IS NOT NULL AND "released_at" IS NULL AND "release_reason" IS NULL)
            OR ("status" = 'RELEASED' AND "completed_at" IS NULL AND "released_at" IS NOT NULL AND "release_reason" IS NOT NULL)
        )
);

CREATE TABLE "loyalty_redemption_movements" (
    "id" UUID NOT NULL,
    "redemption_id" UUID NOT NULL,
    "loyalty_account_id" UUID NOT NULL,
    "type" "LoyaltyRedemptionMovementType" NOT NULL,
    "points" INTEGER NOT NULL,
    "idempotency_key" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_redemption_movements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "loyalty_redemption_movements_points_check" CHECK ("points" > 0),
    CONSTRAINT "loyalty_redemption_movements_idempotency_key_check"
        CHECK ("idempotency_key" = "redemption_id"::text || ':' || "type"::text)
);

CREATE UNIQUE INDEX "loyalty_redemptions_payment_id_key"
ON "loyalty_redemptions"("payment_id");

CREATE INDEX "loyalty_redemptions_loyalty_account_id_status_expires_at_idx"
ON "loyalty_redemptions"("loyalty_account_id", "status", "expires_at");

CREATE INDEX "loyalty_redemptions_benefit_id_status_idx"
ON "loyalty_redemptions"("benefit_id", "status");

CREATE INDEX "loyalty_redemptions_account_id_status_idx"
ON "loyalty_redemptions"("account_id", "status");

CREATE INDEX "loyalty_redemptions_order_id_status_idx"
ON "loyalty_redemptions"("order_id", "status");

-- RELEASED attempts remain in history and may be retried. RESERVED and
-- COMPLETED rows block another canje for the same purchase.
CREATE UNIQUE INDEX "loyalty_redemptions_one_account_use"
ON "loyalty_redemptions"("account_id")
WHERE "account_id" IS NOT NULL AND "status" IN ('RESERVED', 'COMPLETED');

CREATE UNIQUE INDEX "loyalty_redemptions_one_order_use"
ON "loyalty_redemptions"("order_id")
WHERE "order_id" IS NOT NULL AND "status" IN ('RESERVED', 'COMPLETED');

CREATE UNIQUE INDEX "loyalty_redemption_movements_idempotency_key_key"
ON "loyalty_redemption_movements"("idempotency_key");

CREATE UNIQUE INDEX "loyalty_redemption_movements_redemption_id_type_key"
ON "loyalty_redemption_movements"("redemption_id", "type");

CREATE INDEX "loyalty_redemption_movements_loyalty_account_id_created_at_idx"
ON "loyalty_redemption_movements"("loyalty_account_id", "created_at");

ALTER TABLE "loyalty_redemptions"
ADD CONSTRAINT "loyalty_redemptions_loyalty_account_id_fkey"
FOREIGN KEY ("loyalty_account_id") REFERENCES "loyalty_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The H22 migration must install the benefit_id FK after creating loyalty_benefits.
ALTER TABLE "loyalty_redemptions"
ADD CONSTRAINT "loyalty_redemptions_account_id_fkey"
FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "loyalty_redemptions"
ADD CONSTRAINT "loyalty_redemptions_order_id_fkey"
FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "loyalty_redemptions"
ADD CONSTRAINT "loyalty_redemptions_payment_id_fkey"
FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "loyalty_redemption_movements"
ADD CONSTRAINT "loyalty_redemption_movements_redemption_id_fkey"
FOREIGN KEY ("redemption_id") REFERENCES "loyalty_redemptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "loyalty_redemption_movements"
ADD CONSTRAINT "loyalty_redemption_movements_loyalty_account_id_fkey"
FOREIGN KEY ("loyalty_account_id") REFERENCES "loyalty_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- H21 service transactions must acquire explicit locks in this order:
-- LoyaltyAccount -> purchase (Account/Order) -> Payment. SQL UPDATEs also take
-- the redemption row lock before row triggers run; keep other trigger paths
-- from taking these locks in reverse order. All lifecycle changes and their
-- movement/account updates must commit in one transaction.
-- Redemption ownership and target snapshots are immutable after insertion.
CREATE FUNCTION "enforce_loyalty_redemption_integrity"() RETURNS TRIGGER AS $$
DECLARE
    loyalty_owner_id UUID;
    purchase_owner_id UUID;
    purchase_account_id UUID;
    payment_account_id UUID;
    payment_order_id UUID;
    payment_status "PaymentStatus";
    affected_rows INTEGER;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW."status" <> 'RESERVED' THEN
            RAISE EXCEPTION 'A new loyalty redemption must start RESERVED'
                USING ERRCODE = '23514';
        END IF;
    ELSE
        IF NEW."loyalty_account_id" IS DISTINCT FROM OLD."loyalty_account_id"
            OR NEW."benefit_id" IS DISTINCT FROM OLD."benefit_id"
            OR NEW."account_id" IS DISTINCT FROM OLD."account_id"
            OR NEW."order_id" IS DISTINCT FROM OLD."order_id"
            OR NEW."points_reserved" IS DISTINCT FROM OLD."points_reserved"
            OR NEW."subtotal_amount" IS DISTINCT FROM OLD."subtotal_amount"
            OR NEW."discount_amount" IS DISTINCT FROM OLD."discount_amount"
            OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at"
            OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
            RAISE EXCEPTION 'Loyalty redemption snapshots and ownership are immutable'
                USING ERRCODE = '23514';
        END IF;

        IF OLD."payment_id" IS NOT NULL
            AND NEW."payment_id" IS DISTINCT FROM OLD."payment_id" THEN
            RAISE EXCEPTION 'A loyalty redemption payment cannot be replaced'
                USING ERRCODE = '23514';
        END IF;

        IF NEW."status" IS DISTINCT FROM OLD."status"
            AND (OLD."status" <> 'RESERVED'
                OR NEW."status" NOT IN ('COMPLETED', 'RELEASED')) THEN
            RAISE EXCEPTION 'Only RESERVED redemptions can transition to COMPLETED or RELEASED'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    SELECT "user_id" INTO loyalty_owner_id
    FROM "loyalty_accounts"
    WHERE "id" = NEW."loyalty_account_id"
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Loyalty account does not exist'
            USING ERRCODE = '23503';
    END IF;

    IF NEW."account_id" IS NOT NULL THEN
        SELECT "customer_id" INTO purchase_owner_id
        FROM "accounts"
        WHERE "id" = NEW."account_id"
        FOR UPDATE;

        IF NOT FOUND OR purchase_owner_id IS NULL
            OR purchase_owner_id IS DISTINCT FROM loyalty_owner_id THEN
            RAISE EXCEPTION 'Loyalty account owner does not own this table account'
                USING ERRCODE = '23514';
        END IF;
    ELSE
        SELECT "customer_id", "account_id"
        INTO purchase_owner_id, purchase_account_id
        FROM "orders"
        WHERE "id" = NEW."order_id"
        FOR UPDATE;

        IF NOT FOUND OR purchase_account_id IS NOT NULL
            OR purchase_owner_id IS NULL
            OR purchase_owner_id IS DISTINCT FROM loyalty_owner_id THEN
            RAISE EXCEPTION 'Loyalty account owner does not own this takeaway order'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF NEW."payment_id" IS NOT NULL THEN
        SELECT "account_id", "order_id", "status"
        INTO payment_account_id, payment_order_id, payment_status
        FROM "payments"
        WHERE "id" = NEW."payment_id"
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Payment does not exist'
                USING ERRCODE = '23503';
        END IF;

        IF payment_account_id IS DISTINCT FROM NEW."account_id"
            OR payment_order_id IS DISTINCT FROM NEW."order_id" THEN
            RAISE EXCEPTION 'Payment target does not match loyalty redemption purchase'
                USING ERRCODE = '23514';
        END IF;

        IF NEW."status" = 'COMPLETED' AND payment_status <> 'APPROVED' THEN
            RAISE EXCEPTION 'A loyalty redemption requires an approved payment'
                USING ERRCODE = '23514';
        END IF;

        IF NEW."status" = 'RELEASED'
            AND NEW."release_reason" = 'PAYMENT_REJECTED'
            AND payment_status <> 'REJECTED' THEN
            RAISE EXCEPTION 'PAYMENT_REJECTED release requires a rejected payment'
                USING ERRCODE = '23514';
        END IF;

        IF NEW."status" = 'RELEASED'
            AND NEW."release_reason" <> 'PAYMENT_REJECTED'
            AND payment_status = 'APPROVED' THEN
            RAISE EXCEPTION 'An approved payment cannot release its redemption'
                USING ERRCODE = '23514';
        END IF;
    ELSIF NEW."status" = 'COMPLETED'
        OR (NEW."status" = 'RELEASED' AND NEW."release_reason" = 'PAYMENT_REJECTED') THEN
        RAISE EXCEPTION 'This redemption transition requires a payment'
            USING ERRCODE = '23514';
    END IF;

    -- PostgreSQL owns point mutations for lifecycle transitions. The
    -- repository changes the redemption and inserts its movement in the same
    -- transaction; this trigger applies the matching account mutation.
    IF TG_OP = 'UPDATE' AND NEW."status" IS DISTINCT FROM OLD."status" THEN
        IF NEW."status" = 'COMPLETED' THEN
            UPDATE "loyalty_accounts"
            SET "balance" = "balance" - NEW."points_reserved",
                "reserved_points" = "reserved_points" - NEW."points_reserved",
                "updated_at" = CURRENT_TIMESTAMP
            WHERE "id" = NEW."loyalty_account_id"
              AND "balance" >= NEW."points_reserved"
              AND "reserved_points" >= NEW."points_reserved";
        ELSIF NEW."status" = 'RELEASED' THEN
            UPDATE "loyalty_accounts"
            SET "reserved_points" = "reserved_points" - NEW."points_reserved",
                "updated_at" = CURRENT_TIMESTAMP
            WHERE "id" = NEW."loyalty_account_id"
              AND "reserved_points" >= NEW."points_reserved";
        END IF;

        GET DIAGNOSTICS affected_rows = ROW_COUNT;
        IF affected_rows <> 1 THEN
            RAISE EXCEPTION 'Insufficient points for redemption transition'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "loyalty_redemption_integrity_trigger"
BEFORE INSERT OR UPDATE ON "loyalty_redemptions"
FOR EACH ROW EXECUTE FUNCTION "enforce_loyalty_redemption_integrity"();

-- Owners cannot be changed after a redemption has captured the purchase/account.
CREATE FUNCTION "prevent_loyalty_owner_change"() RETURNS TRIGGER AS $$
BEGIN
    IF NEW."user_id" IS DISTINCT FROM OLD."user_id"
        AND EXISTS (SELECT 1 FROM "loyalty_redemptions" WHERE "loyalty_account_id" = OLD."id") THEN
        RAISE EXCEPTION 'A loyalty account owner with redemptions cannot be changed'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "loyalty_account_owner_immutable_trigger"
BEFORE UPDATE OF "user_id" ON "loyalty_accounts"
FOR EACH ROW EXECUTE FUNCTION "prevent_loyalty_owner_change"();

CREATE FUNCTION "prevent_account_customer_change_with_redemption"() RETURNS TRIGGER AS $$
BEGIN
    IF NEW."customer_id" IS DISTINCT FROM OLD."customer_id"
        AND EXISTS (SELECT 1 FROM "loyalty_redemptions" WHERE "account_id" = OLD."id") THEN
        RAISE EXCEPTION 'An account customer with a loyalty redemption cannot be changed'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "account_customer_redemption_immutable_trigger"
BEFORE UPDATE OF "customer_id" ON "accounts"
FOR EACH ROW EXECUTE FUNCTION "prevent_account_customer_change_with_redemption"();

CREATE FUNCTION "prevent_order_customer_change_with_redemption"() RETURNS TRIGGER AS $$
BEGIN
    IF (NEW."customer_id" IS DISTINCT FROM OLD."customer_id"
        OR NEW."account_id" IS DISTINCT FROM OLD."account_id")
        AND EXISTS (SELECT 1 FROM "loyalty_redemptions" WHERE "order_id" = OLD."id") THEN
        RAISE EXCEPTION 'An order owner/target with a loyalty redemption cannot be changed'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "order_customer_redemption_immutable_trigger"
BEFORE UPDATE OF "customer_id", "account_id" ON "orders"
FOR EACH ROW EXECUTE FUNCTION "prevent_order_customer_change_with_redemption"();

-- Payment target is immutable after insertion; this removes races between
-- target updates and attaching a payment to a redemption.
CREATE FUNCTION "prevent_payment_target_change"() RETURNS TRIGGER AS $$
BEGIN
    IF NEW."account_id" IS DISTINCT FROM OLD."account_id"
        OR NEW."order_id" IS DISTINCT FROM OLD."order_id" THEN
        RAISE EXCEPTION 'Payment target is immutable'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "payment_target_immutable_trigger"
BEFORE UPDATE OF "account_id", "order_id" ON "payments"
FOR EACH ROW EXECUTE FUNCTION "prevent_payment_target_change"();

CREATE FUNCTION "prevent_rejecting_completed_redemption_payment"() RETURNS TRIGGER AS $$
BEGIN
    IF NEW."status" IS DISTINCT FROM OLD."status"
        AND NEW."status" <> 'APPROVED'
        AND EXISTS (
            SELECT 1 FROM "loyalty_redemptions"
            WHERE "payment_id" = OLD."id" AND "status" = 'COMPLETED'
        ) THEN
        RAISE EXCEPTION 'A completed redemption payment cannot be rejected'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "payment_redemption_status_trigger"
BEFORE UPDATE OF "status" ON "payments"
FOR EACH ROW EXECUTE FUNCTION "prevent_rejecting_completed_redemption_payment"();

CREATE FUNCTION "enforce_redemption_movement_integrity"() RETURNS TRIGGER AS $$
DECLARE
    redemption_account_id UUID;
    redemption_points INTEGER;
    redemption_status "LoyaltyRedemptionStatus";
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Loyalty redemption movements are immutable'
            USING ERRCODE = '23514';
    END IF;

    SELECT "loyalty_account_id", "points_reserved", "status"
    INTO redemption_account_id, redemption_points, redemption_status
    FROM "loyalty_redemptions"
    WHERE "id" = NEW."redemption_id"
    FOR UPDATE;

    IF NOT FOUND OR NEW."loyalty_account_id" IS DISTINCT FROM redemption_account_id THEN
        RAISE EXCEPTION 'Movement account must match its redemption account'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."points" <> redemption_points THEN
        RAISE EXCEPTION 'Movement points must match the reserved redemption points'
            USING ERRCODE = '23514';
    END IF;

    IF (NEW."type" = 'RESERVED' AND redemption_status <> 'RESERVED')
        OR (NEW."type" = 'SPENT' AND redemption_status <> 'COMPLETED')
        OR (NEW."type" = 'RELEASED' AND redemption_status <> 'RELEASED') THEN
        RAISE EXCEPTION 'Movement type must match the redemption state transition'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "loyalty_redemption_movement_integrity_trigger"
BEFORE INSERT OR UPDATE OR DELETE ON "loyalty_redemption_movements"
FOR EACH ROW EXECUTE FUNCTION "enforce_redemption_movement_integrity"();

-- Deferred checks require the state transition, point-account change and its
-- idempotent movement to be committed in the same database transaction.
CREATE FUNCTION "check_loyalty_redemption_lifecycle"() RETURNS TRIGGER AS $$
DECLARE
    v_redemption_id UUID;
    v_loyalty_account_id UUID;
    v_points_reserved INTEGER;
    v_redemption_status "LoyaltyRedemptionStatus";
    v_payment_id UUID;
    v_release_reason "LoyaltyRedemptionReleaseReason";
    v_payment_status "PaymentStatus";
    v_account_reserved_points INTEGER;
    v_active_reserved_sum BIGINT;
    v_reserved_count BIGINT;
    v_spent_count BIGINT;
    v_released_count BIGINT;
BEGIN
    IF TG_TABLE_NAME = 'payments' THEN
        SELECT r."id" INTO v_redemption_id
        FROM "loyalty_redemptions" AS r
        WHERE r."payment_id" = NEW."id";
        IF NOT FOUND THEN
            RETURN NULL;
        END IF;
    ELSIF TG_TABLE_NAME = 'loyalty_redemption_movements' THEN
        IF TG_OP = 'DELETE' THEN
            v_redemption_id := OLD."redemption_id";
        ELSE
            v_redemption_id := NEW."redemption_id";
        END IF;
    ELSIF TG_TABLE_NAME = 'loyalty_accounts' THEN
        IF TG_OP = 'DELETE' THEN
            v_loyalty_account_id := OLD."id";
        ELSE
            v_loyalty_account_id := NEW."id";
        END IF;

        SELECT la."reserved_points" INTO v_account_reserved_points
        FROM "loyalty_accounts" AS la
        WHERE la."id" = v_loyalty_account_id;
        IF NOT FOUND THEN
            RETURN NULL;
        END IF;

        SELECT COALESCE(SUM(r."points_reserved"), 0) INTO v_active_reserved_sum
        FROM "loyalty_redemptions" AS r
        WHERE r."loyalty_account_id" = v_loyalty_account_id
          AND r."status" = 'RESERVED';

        IF v_account_reserved_points <> v_active_reserved_sum THEN
            RAISE EXCEPTION 'reserved_points must equal the sum of RESERVED redemptions'
                USING ERRCODE = '23514';
        END IF;
        RETURN NULL;
    ELSE
        IF TG_OP = 'DELETE' THEN
            v_redemption_id := OLD."id";
        ELSE
            v_redemption_id := NEW."id";
        END IF;
    END IF;

    SELECT r."loyalty_account_id", r."points_reserved", r."status",
           r."payment_id", r."release_reason"
    INTO v_loyalty_account_id, v_points_reserved, v_redemption_status,
         v_payment_id, v_release_reason
    FROM "loyalty_redemptions" AS r
    WHERE r."id" = v_redemption_id;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    SELECT COUNT(*) FILTER (WHERE m."type" = 'RESERVED'),
           COUNT(*) FILTER (WHERE m."type" = 'SPENT'),
           COUNT(*) FILTER (WHERE m."type" = 'RELEASED')
    INTO v_reserved_count, v_spent_count, v_released_count
    FROM "loyalty_redemption_movements" AS m
    WHERE m."redemption_id" = v_redemption_id;

    IF v_redemption_status = 'RESERVED'
        AND (v_reserved_count <> 1 OR v_spent_count <> 0 OR v_released_count <> 0) THEN
        RAISE EXCEPTION 'RESERVED redemption requires only one RESERVED movement'
            USING ERRCODE = '23514';
    ELSIF v_redemption_status = 'COMPLETED'
        AND (v_reserved_count <> 1 OR v_spent_count <> 1 OR v_released_count <> 0) THEN
        RAISE EXCEPTION 'COMPLETED redemption requires RESERVED and SPENT movements'
            USING ERRCODE = '23514';
    ELSIF v_redemption_status = 'RELEASED'
        AND (v_reserved_count <> 1 OR v_spent_count <> 0 OR v_released_count <> 1) THEN
        RAISE EXCEPTION 'RELEASED redemption requires RESERVED and RELEASED movements'
            USING ERRCODE = '23514';
    END IF;

    SELECT la."reserved_points" INTO v_account_reserved_points
    FROM "loyalty_accounts" AS la
    WHERE la."id" = v_loyalty_account_id;

    SELECT COALESCE(SUM(r."points_reserved"), 0) INTO v_active_reserved_sum
    FROM "loyalty_redemptions" AS r
    WHERE r."loyalty_account_id" = v_loyalty_account_id
      AND r."status" = 'RESERVED';

    IF v_account_reserved_points <> v_active_reserved_sum THEN
        RAISE EXCEPTION 'reserved_points must equal the sum of RESERVED redemptions'
            USING ERRCODE = '23514';
    END IF;

    IF v_payment_id IS NOT NULL THEN
        SELECT p."status" INTO v_payment_status
        FROM "payments" AS p
        WHERE p."id" = v_payment_id;
    END IF;

    IF v_redemption_status = 'COMPLETED'
        AND (v_payment_id IS NULL OR v_payment_status <> 'APPROVED') THEN
        RAISE EXCEPTION 'COMPLETED redemption requires an APPROVED payment'
            USING ERRCODE = '23514';
    ELSIF v_redemption_status = 'RELEASED' AND v_release_reason = 'PAYMENT_REJECTED'
        AND (v_payment_id IS NULL OR v_payment_status <> 'REJECTED') THEN
        RAISE EXCEPTION 'PAYMENT_REJECTED release requires a REJECTED payment'
            USING ERRCODE = '23514';
    ELSIF v_redemption_status = 'RESERVED' AND v_payment_id IS NOT NULL
        AND v_payment_status IS NOT NULL THEN
        RAISE EXCEPTION 'A redemption linked to a terminal payment must be completed or released in this transaction'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "loyalty_redemption_lifecycle_constraint"
AFTER INSERT OR UPDATE ON "loyalty_redemptions"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "check_loyalty_redemption_lifecycle"();

CREATE CONSTRAINT TRIGGER "loyalty_redemption_movement_lifecycle_constraint"
AFTER INSERT ON "loyalty_redemption_movements"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "check_loyalty_redemption_lifecycle"();

CREATE CONSTRAINT TRIGGER "loyalty_account_reserved_points_constraint"
AFTER INSERT OR UPDATE ON "loyalty_accounts"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "check_loyalty_redemption_lifecycle"();

-- A payment cannot be committed in a terminal state while its redemption is
-- still RESERVED. The paired redemption transition and movement must happen
-- in the same transaction as the payment status update.
CREATE CONSTRAINT TRIGGER "payment_redemption_lifecycle_constraint"
AFTER UPDATE OF "status" ON "payments"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "check_loyalty_redemption_lifecycle"();
