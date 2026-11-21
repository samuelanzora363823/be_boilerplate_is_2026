# 06. Despliegue en producción

## Infraestructura
- Proveedor: Amazon Web Services (AWS).
- Servicio: EC2.
- Sistema operativo: Ubuntu 24.04.
- Contenedores: Docker.
- Proxy inverso: Nginx.
- Certificado HTTPS: Let’s Encrypt.

## Componentes desplegados
- Frontend: Next.js 16.
- Backend: NestJS 12.
- Base de datos: PostgreSQL 18.

## Versión desplegada
La aplicación se desplegó desde la etiqueta Git v1.0.0.
Los repositorios frontend y backend se mantienen separados.

## Direcciones públicas
- Aplicación: https://18.218.151.130.sslip.io/login
- Swagger: https://18.218.151.130.sslip.io/api/docs

## Configuración
Las variables de entorno se almacenan en archivos .env.
Los archivos .env.example documentan los nombres requeridos.
Las contraseñas, tokens y secretos no se publican en GitHub.

## Funcionamiento
Nginx recibe las solicitudes HTTPS y las dirige a los servicios internos.
El frontend y el backend se ejecutan en contenedores independientes.
PostgreSQL se ejecuta en Docker y almacena los datos del sistema.

## Mantenimiento
Para revisar el estado de los contenedores se utiliza docker ps.
Para consultar registros se utiliza docker logs.
Las actualizaciones deben realizarse de forma controlada.
