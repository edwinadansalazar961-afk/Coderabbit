<!-- coderabbit-ai-generated:v1 -->

# Rootz Link

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:14adb15c3ad932d33a23be29320ea392f8f40987811b8e2dc3436342732c96e4 -->

Una página para obtener enlaces directos de Rootz y AkiraBox cuando el proveedor los entrega.

<!-- /coderabbit-ai-generated:v1 -->

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

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:371f04231cc37fd52f2ba40be7814effe7dbb95f0cc1acf95283a0944c7a1cba -->

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:6d3306520a7d6a574b6400c2e6e7ed3933228da92915069e5b76946e098130a5 -->

## Servicio propio de descargas (prototipo)

El servicio opcional descarga archivos compatibles a una carpeta local y devuelve un enlace temporal. Para activarlo, configura `DEBRID_DATA_DIR` con una carpeta dedicada y `DEBRID_ACCESS_TOKEN` con una clave aleatoria de 24 a 512 caracteres URL-safe, y reinicia el servidor. Introduce esa misma clave en «Usar mi servicio de descargas». No publiques la clave ni la guardes en el repositorio.

Solo se procesa una descarga a la vez, con un máximo de cinco trabajos. Por defecto, los archivos se conservan una hora, con un máximo de 10 GiB por archivo y 20 GiB en total. Se pueden ajustar con `DEBRID_TTL_MS`, `DEBRID_MAX_BYTES` y `DEBRID_TOTAL_BYTES`. El enlace es una dirección difícil de adivinar: cualquiera que la tenga puede descargar el archivo. Los trabajos viven en memoria y se pierden al reiniciar. El servicio gratuito de Render usa almacenamiento temporal y elimina los archivos al reiniciar o suspenderse.

El servicio propio no elimina por sí mismo los requisitos de los proveedores: AkiraBox puede pedir una verificación y 1fichier una clave API y créditos. Si AkiraBox entrega una URL directa tras la verificación, también puedes introducir esa URL en el modo de servicio. El prototipo acepta descargas HTTPS de los dominios compatibles y conexiones IPv4 públicas.

## 1fichier

<!-- /coderabbit-ai-generated:v1 -->

Para generar enlaces de 1fichier, introduce en la página una clave API de una cuenta compatible (Premium, Premium Light, Premium GOLD, Access o CDN). La clave se envía al servidor de la aplicación y de ahí a la API oficial de 1fichier; úsala solo a través de HTTPS y con un servidor de confianza. Se procesa para esa solicitud y no se guarda. Si el archivo tiene contraseña, introdúcela en el campo opcional. La API indica que el enlace generado es temporal y normalmente tiene una validez de cinco minutos.

1fichier puede rechazar solicitudes desde servidores o requerir créditos CDN; sin una clave compatible se puede abrir el archivo en 1fichier para seguir su flujo de descarga.

## Limitaciones

<!-- /coderabbit-ai-generated:v1 -->

<!-- /coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:aa2930641b0d98e143aa66da3b6b01ced9cd448130226f3683c7c74f270fdd2d -->

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:24324987a3869ee05d208c92a3930cf91d428ff88218497b3aea21566777e251 -->

Se puede introducir la contraseña de un archivo protegido; la aplicación la envía a Rootz para verificarla y no la guarda. El flujo con contraseña depende de Rootz y no se ha probado con un archivo protegido real. Rootz también puede limitar las descargas, bloquear solicitudes, retirar archivos o exigir inicio de sesión. Esos enlaces pueden no resolverse. Consultar la URL cuenta como una solicitud de descarga y puede activar el límite de Rootz. Las URL directas pueden caducar.

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:0a29d000bb9d6d4283fe93b95e8068b9b84f154054defbb93d4587feb1772fee -->

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:98a9d3dcdf8129d82748caa8909a81ea482f482df9d9faac35bb2a0d1765d60c -->

Para evitar consultas repetidas, la página conserva durante dos minutos y solo en la pestaña los enlaces de Rootz sin firma obtenidos sin contraseña. Los reutiliza sin comprobar de nuevo si siguen disponibles. Cuando Rootz devuelve un límite temporal, el servidor también intenta consultar su endpoint de metadatos para archivos que Rootz identifica como públicos, activos y disponibles. Este método depende de Rootz y puede dejar de funcionar o no estar disponible para algunos archivos. Los archivos protegidos mantienen el flujo de contraseña y sus límites.

AkiraBox puede exigir una verificación en su página antes de generar el enlace directo. En ese caso, la aplicación muestra un enlace para abrir AkiraBox y completar la comprobación; no puede devolver el enlace automáticamente. Las contraseñas de AkiraBox deben introducirse en AkiraBox.

<!-- /coderabbit-ai-generated:v1 -->

<!-- /coderabbit-ai-generated:v1 -->

<!-- /coderabbit-ai-generated:v1 -->

<!-- /coderabbit-ai-generated:v1 -->

Para ejecutar las pruebas: `node --test server.test.js`.
