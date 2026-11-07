
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded } from 'express';

import { AppModule } from './app.module.js';
import type { EnvConfig } from '@Config';

const API_PREFIX = 'api/v1';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService<EnvConfig, true>);

  // Permitir fotografías de hasta 5 MiB codificadas en JSON/base64.
  // Se establece 8 MB porque base64 aumenta el tamaño del archivo.
  app.use(json({ limit: '8mb' }));
  app.use(
    urlencoded({
      extended: true,
      limit: '8mb',
    }),
  );

  // Permitir solicitudes desde el frontend Next.js.
  app.enableCors({
    origin: [
      'http://localhost:3001',
      'http://127.0.0.1:3001',
      'http://10.192.41.104:3001',
    ],
    methods: [
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'OPTIONS',
    ],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
    ],
  });

  // Versionado en la URI: /api/v1/...
  app.setGlobalPrefix(API_PREFIX);

  // Validaciones globales.
  app.useGlobalPipes(
    new ValidationPipe({
      // Descarta propiedades que no estén en el DTO.
      whitelist: true,

      // Rechaza solicitudes con propiedades no permitidas.
      forbidNonWhitelisted: true,

      // Convierte el payload al tipo del DTO.
      transform: true,
    }),
  );

  // Cierre controlado de la aplicación.
  app.enableShutdownHooks();

  // Configuración de Swagger.
  const swaggerConfig = new DocumentBuilder()
    .setTitle('SI Backend Boilerplate')
    .setDescription(
      'API REST con autenticación por usuario y contraseña.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  SwaggerModule.setup(
    'api/docs',
    app,
    SwaggerModule.createDocument(app, swaggerConfig),
  );

  // Puerto configurado en las variables de entorno.
  const port = configService.get('PORT', { infer: true });

  await app.listen(port);

  console.log(
    `Backend iniciado en http://localhost:${port}/${API_PREFIX}`,
  );
}

await bootstrap();
