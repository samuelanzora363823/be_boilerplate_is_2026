# 05. Instalación local

## Requisitos
- Git.
- Docker y Docker Compose.
- Node.js y npm, si se ejecutan servicios fuera de Docker.

## Repositorios
- Backend: https://github.com/samuelanzora363823/be_boilerplate_is_2026
- Frontend: https://github.com/samuelanzora363823/fe_boilerplate_is_2026

## Preparación
1. Clonar ambos repositorios.
2. Crear los archivos .env a partir de .env.example.
3. Configurar las variables de entorno necesarias.
4. Iniciar PostgreSQL y el backend según el README del repositorio.
5. Ejecutar las migraciones y el seed de Prisma.
6. Instalar las dependencias e iniciar el frontend.

## Comandos del backend
```bash
npm install
npx prisma generate
npx prisma migrate deploy
npm run db:seed
npm run start:dev
```

## Comandos del frontend
```bash
npm install
npm run dev
```

## Pruebas
En el backend se pueden ejecutar las pruebas con npm test.
Las variables y credenciales privadas no deben subirse al repositorio.
