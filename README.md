# HTTP Latino Free

Add-on para Stremio que provee acceso a contenido en español latino.


## Características

- Soporte para películas, series y anime
- Búsqueda automatizada desde múltiples fuentes públicas
- Transmisión directa y enlaces externos compatibles
- Selección automática de la mejor calidad disponible


## Arquitectura

El add-on implementa el protocolo oficial de Stremio utilizando el SDK
[stremio-addon-sdk](https://github.com/Stremio/stremio-addon-sdk).

```
├── addon.js          Servidor principal (manifiesto + resolución de streams)
├── lib/
│   ├── tmdb.js       Conversión de IDs IMDB → TMDB vía API pública
│   └── provider-bridge.js   Carga, ejecución y filtrado de proveedores
├── manifest.json     Registro de proveedores
├── providers/        Módulos de resolución de contenido
└── package.json
```

### Flujo de trabajo

1. Stremio solicita streams vía `/stream/{tipo}/{idIMDB}.json`
2. El ID de IMDB se convierte a ID de TMDB usando la API pública de TMDB
3. El puente de proveedores activa todos los módulos en paralelo
4. Los resultados se filtran (solo enlaces directos m3u8/mp4 y embebidos
   reproducibles)
5. Las transmisiones se entregan en el formato nativo de Stremio


## Instalación

### Requisitos

- Node.js 18 o superior
- npm

### Configuración local

```bash
cd stremio-addon
npm install
npm start
```

El servidor se inicia en `http://localhost:7000`

### Instalar en Stremio

1. Abrir Stremio
2. Ir a Complementos → "Instalar desde URL"
3. Ingresar `http://localhost:7000/manifest.json`

O directamente desde la terminal:

```bash
npm start -- --install
```

### Despliegue público

Para acceso público, desplegar en un servicio de hosting (Railway, Render,
Fly.io, etc.) y compartir la URL del manifiesto:
`https://tu-dominio.com/manifest.json`


## Pruebas

```bash
# Verificar el manifiesto
curl http://localhost:7000/manifest.json

# Probar stream de película
curl "http://localhost:7000/stream/movie/tt0111161.json"

# Probar stream de serie
curl "http://localhost:7000/stream/series/tt0903747:1:1.json"
```


## Aviso legal

Este add-on es una herramienta de indexación que **no aloja, almacena,
reproduce ni distribuye ningún tipo de contenido protegido por derechos de
autor**. Únicamente actúa como un intermediario técnico que resuelve y
presenta enlaces a contenido disponible públicamente en internet.

El add-on no está afiliado, asociado, autorizado ni respaldado por ninguna
plataforma de streaming, estudio cinematográfico, cadena de televisión o
titular de derechos.

Los usuarios son los únicos responsables del uso que hagan de esta
herramienta y deben asegurarse de cumplir con las leyes aplicables en su
jurisdicción.

Este proyecto se distribuye exclusivamente con fines educativos y de
investigación sobre protocolos de comunicación y arquitecturas de software.


## Dependencias

- [stremio-addon-sdk](https://github.com/Stremio/stremio-addon-sdk) —
  framework oficial para add-ons de Stremio
- [axios](https://axios-http.com/) — cliente HTTP
- [cheerio](https://cheerio.js.org/) — análisis de HTML
- [crypto-js](https://github.com/brix/crypto-js) — funciones criptográficas
