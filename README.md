<!-- coderabbit-ai-generated:v1 -->

# Rootz Link

Una página para obtener la URL a la que Rootz redirige una descarga pública.

## Ejecutar

Se necesita Node.js 18 o posterior. Desde esta carpeta:

```sh
node server.js
```

Abre http://localhost:4173. Se puede cambiar el puerto mediante la variable `PORT`. La página necesita el servidor: el navegador no puede leer directamente la redirección entre sitios.

## Limitaciones

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:aa2930641b0d98e143aa66da3b6b01ced9cd448130226f3683c7c74f270fdd2d -->

Se puede introducir la contraseña de un archivo protegido; la aplicación la envía a Rootz para verificarla y no la guarda. El flujo con contraseña depende de Rootz y no se ha probado con un archivo protegido real. Rootz también puede limitar las descargas, bloquear solicitudes, retirar archivos o exigir inicio de sesión. Esos enlaces pueden no resolverse. Consultar la URL cuenta como una solicitud de descarga y puede activar el límite de Rootz. Las URL directas pueden caducar.

<!-- /coderabbit-ai-generated:v1 -->

Para ejecutar las pruebas: `node --test server.test.js`.
