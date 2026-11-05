
-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_name_key"
ON "categories"("name");

-- Registrar la categoría utilizada por los platillos existentes.
INSERT INTO "categories" ("id", "name")
VALUES (
    '92c7329b-5134-4a9c-b26b-7c1a247f8395',
    'Platos fuertes'
);

-- AddForeignKey
ALTER TABLE "dishes"
ADD CONSTRAINT "dishes_category_id_fkey"
FOREIGN KEY ("category_id")
REFERENCES "categories"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

