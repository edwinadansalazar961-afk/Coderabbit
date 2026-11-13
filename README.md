<!-- coderabbit-ai-generated:v1 -->

# Rootz Link

Una página para obtener la URL a la que Rootz redirige una descarga pública.

## Ejecutar

Se necesita Node.js 18 o posterior. Desde esta carpeta:

```sh
node server.js
```

Abre http://localhost:4173. Se puede cambiar el puerto mediante la variable `PORT`. La página necesita el servidor: el navegador no puede leer directamente la redirección entre sitios.

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:379a0224287aff095c1065aa8a8af254298def02f05ec6903fd1b6b66774fc51 -->

## Publicar con GitHub Pages y Render

GitHub Pages solo aloja la interfaz estática. El servidor Node debe estar disponible por HTTPS para consultar Rootz. La configuración `render.yaml` prepara un servicio gratuito en Render:

1. En Render, crea un Blueprint desde este repositorio y selecciona la rama publicada. Render necesita acceso al repositorio.
2. Copia la URL HTTPS del servicio creado, por ejemplo `https://tu-servicio.onrender.com`. El plan gratuito puede tardar en responder después de un periodo sin actividad.
3. En `index.html`, pon esa URL en el atributo `content` de la etiqueta `rootz-api-base`, y publica el cambio en la rama utilizada por Pages. No añadas contraseñas ni claves al archivo.
4. En la configuración de GitHub Pages, selecciona esa rama y la carpeta `/ (root)`.
5. Abre el sitio de Pages y prueba un enlace público de Rootz. La disponibilidad depende también de que Rootz acepte las solicitudes desde el servidor de Render.

El servidor permite peticiones desde `https://edwinadansalazar961-afk.github.io` mediante la variable `ALLOWED_ORIGIN`. Si publicas en otro dominio, actualiza esa variable con el origen HTTPS exacto. La URL del servidor debe ser HTTPS para proteger las contraseñas.

## Limitaciones

<!-- /coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:aa2930641b0d98e143aa66da3b6b01ced9cd448130226f3683c7c74f270fdd2d -->

Se puede introducir la contraseña de un archivo protegido; la aplicación la envía a Rootz para verificarla y no la guarda. El flujo con contraseña depende de Rootz y no se ha probado con un archivo protegido real. Rootz también puede limitar las descargas, bloquear solicitudes, retirar archivos o exigir inicio de sesión. Esos enlaces pueden no resolverse. Consultar la URL cuenta como una solicitud de descarga y puede activar el límite de Rootz. Las URL directas pueden caducar.

<!-- /coderabbit-ai-generated:v1 -->

Para ejecutar las pruebas: `node --test server.test.js`.
