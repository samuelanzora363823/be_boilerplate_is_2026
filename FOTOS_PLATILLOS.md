# Fotografías de platillos

- El modelo `Dish` incluye `imageUrl` (opcional). La migración nueva agrega la columna a `dishes`.
- **Nota**: el ZIP original ya traía una migración llamada `add_dish_image` que en realidad añadió `image_url` a `order_items`. Se conserva intacta para evitar modificar historial aplicado; la nueva migración agrega el campo correcto a `dishes`.
- El gerente guarda primero el platillo y después sube la foto a `POST /api/v1/menu/dish/:id/image` mediante el proxy Next.js.
- Formatos JPG/PNG/WebP, hasta 5 MiB. Se verifica el encabezado del archivo además del MIME.
- El contenedor Docker guarda imágenes en el volumen persistente `dish_images`.
- Las imágenes se muestran mediante `GET /api/menu/images/:filename` de Next.js, que consulta `GET /api/v1/menu/images/:filename` de NestJS.
- El reemplazo de fotografía deja la anterior en disco (no se elimina automáticamente); conviene implementar limpieza de archivos huérfanos en producción.
- El almacenamiento es local al contenedor/volumen. Para despliegues distribuidos, usar almacenamiento de objetos compartido.
