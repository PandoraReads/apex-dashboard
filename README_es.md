# Apex Dashboard

> Deja de alternar entre notas de Obsidian. Una sola página. Todo lo que necesitas. Anota tus pensamientos, arrasa con tus todos, haz seguimiento de tus proyectos — y hazlo con un aspecto increíble.

## Captura de pantalla

![Apex Dashboard](screenshot1.png)

**Idioma / Language**: [English](README_EN.md) | [简体中文](README.md) | [繁體中文](README_zh-TW.md) | [日本語](README_ja.md) | [한국어](README_ko.md) | **Español** | [Français](README_fr.md) | [Deutsch](README_de.md) | [Português (Brasil)](README_pt-BR.md) | [Русский](README_ru.md) | [ไทย](README_th.md)

## Características

### 🗒️ Memo
Captura ideas al instante con una libreta de memorandos integrada. Cada tarjeta de memo tiene un área de texto editable: anota ideas, notas de reuniones o reflexiones diarias sin salir de tu dashboard. Admite `[[wikilinks]]` que se muestran como enlaces clicables.

### ✅ Todo
Gestiona tareas con listas de verificación interactivas. Añade, reordena, arrastra y suelta, y marca tareas como completadas. Una barra de progreso muestra el porcentaje de finalización de un vistazo. Los elementos de todo también admiten `[[wikilinks]]` para referencias cruzadas entre notas.

### 📁 Projects
Organiza los documentos de tu vault en tarjetas de proyecto. Cada tarjeta enlaza a notas relacionadas, muestra una imagen de portada (admite tanto imágenes locales del vault como URLs web) y ofrece búsqueda de documentos en línea para añadir archivos rápidamente. Gestiona múltiples tipos de archivo, incluidas notas Markdown, PDF, imágenes, audio y video.

### 📝 Notes
Una sección compacta, en formato de lista, para organizar documentos de referencia y archivos de acceso rápido. Muestra hasta 5 tarjetas por fila sin imágenes de portada para máxima densidad.

### 📅 Calendar
Un calendario nativo de cuadrícula mensual con todas las tareas con fecha de tu vault (sin necesidad de dataview ni plugins externos). Cada celda del día lista sus tareas; haz clic en un día para ver su agenda. Abre un calendario a pantalla completa con navegación por meses y activación de tareas en línea. Los eventos de varios días con `[start::]` / `[end::]` se extienden a lo largo de varios días. La vista ampliada del widget de la barra lateral también está disponible como **sección Calendar** incrustada en el tablero — cuadrícula mensual completa (con barras de eventos multidía), cuadrícula semanal con horas, filtro de tareas y salto a hoy; haz clic en un número de día para añadir una tarea a ese día (se escribe en la nota diaria o en la lista de todos del dashboard).

### 🔍 Dataview
Consulta tu vault con un motor DQL integrado — no necesitas el plugin Dataview. Añade una sección Dataview y escribe consultas como `TABLE file.name, rating FROM "Books" WHERE rating >= 4 SORT rating DESC`. Admite salidas `TABLE`, `LIST`, `TASK`, `CALENDAR` y `HEATMAP` sobre carpetas, etiquetas y enlaces (`FROM`), con cláusulas `WHERE`, `SORT`, `GROUP BY`, `FLATTEN` y `LIMIT`, ~40 funciones integradas, todos los campos implícitos `file.*`, frontmatter YAML y campos en línea (`[key:: value]`). El modal de configuración valida la sintaxis en vivo e incluye consultas de ejemplo de un clic. Las casillas `TASK` se escriben de vuelta en la nota de origen, `CALENDAR` dibuja una cuadrícula mensual y `HEATMAP` dibuja una cuadrícula de contribuciones anual a partir de cualquier campo numérico. Los resultados se actualizan a demanda mediante el botón de actualización de la sección.

### 🌐 Web
Incrusta cualquier página web directamente en una sección — pega una URL y navega por ella como un panel de navegador dentro del tablero. El **modo automático** comprueba previamente la política de incrustación del sitio: los sitios que permiten ser enmarcados se incrustan directamente como iframe, mientras que los que lo rechazan cambian a un webview de escritorio (con su propio inicio de sesión persistente — recomendado para Keep, Todoist web y otras apps que requieren inicio de sesión); en móvil se muestra una tarjeta de respaldo con un botón para abrir en el navegador. También puedes forzar el modo iframe/webview y escalar la página de 0,5× a 2× para apps web densas. En móvil prefiere sitios https; la incrustación está orientada a la lectura — las ventanas emergentes y las descargas pertenecen a un navegador real.

### 📡 RSS
Suscríbete a blogs y fuentes de noticias directamente en el tablero: añade cualquier enlace RSS 2.0 / Atom y los últimos artículos de todas las fuentes fluyen juntos en una única lista cronológica inversa (etiquetas de fuente, puntos de no leído), con un filtro de no leídos y marcar todo como leído. Haz clic en una entrada para leer el artículo completo en un modal — las fuentes que incluyen el texto completo se muestran directamente, y las que solo ofrecen resumen se descargan y se les extrae automáticamente el contenido principal. Cada entrada tiene un botón de descarga que guarda el artículo como nota del vault (nombre con prefijo de fecha, frontmatter de origen, enlace original) en la carpeta configurada; las entradas guardadas saltan directamente a la nota. El contenido de las fuentes se almacena en caché localmente durante 30 minutos; el estado de leído y guardado persiste entre sesiones.

### ⚡ Quick Actions
Fija tus atajos más usados en la barra lateral. Admite dos tipos de acción: enlaces a **Archivo** para abrir cualquier documento, y atajos de **Comando** para ejecutar cualquier comando de Obsidian. Incluye presets integrados para Nuevo diario y Nueva nota.

### 🌤️ Widgets de la barra lateral
La barra lateral izquierda cuenta con 11 widgets activables de forma independiente y reordenables arrastrando:

- **Weather** — Clima en tiempo real con temperatura actual, sensación térmica, humedad, velocidad del viento y un pronóstico de 5 días con temperaturas máximas/mínimas diarias. Impulsado por Open-Meteo (sin necesidad de clave de API). Búsqueda de ciudades con autocompletado de geocodificación para una ubicación precisa
- **Lunar Almanac** — Fecha lunar tradicional china, festividades y orientación diaria de qué hacer y qué evitar
- **Pomodoro Timer** — Un temporizador de enfoque con selector de actividad y ciclos de trabajo/descanso, además de un gráfico de dona del desglose de hoy; la vista de estadísticas añade progreso de objetivo, una puntuación de eficiencia, gráficos de tendencia, un mapa de calor de 12 semanas y una línea de tiempo del día
- **Reading Tracker** — Registra tus sesiones de lectura con un temporizador integrado. Añade libros desde la búsqueda de Douban o introduciéndolos manualmente, cronometra tus sesiones de lectura y registra el progreso con números de página. Cada tarjeta de libro muestra imagen de portada, autor y barra de progreso de lectura
- **Countdown** — Cuentas regresivas personalizables hacia cualquier fecha objetivo, mostradas en días u horas restantes
- **Year Progress** — Cuánto del año en curso ya ha transcurrido
- **Calendar** — Cuadrícula de mes/semana que agrega todas las tareas con fecha de todo el vault; haz clic en un día para ver su agenda y añadir tareas que se escriben en la nota diaria de ese día; los eventos multidía se extienden a lo largo de varios días
- **Habit Check-in** — Marcado diario por hábito, con relleno retroactivo del día anterior, rachas y estadísticas de mapa de calor
- **Expense Tracker** — Registro rápido de gastos/ingresos (notas, fechas retroactivas, categorías personalizadas) con totales del día y estadísticas por semana/mes/año/histórico total; el libro mayor añade filtrado, edición en línea e importación/exportación CSV
- **Photo Album** — Un marco de fotos digital para cualquier carpeta del vault: rotación automática con pausa al pasar el cursor, anterior/siguiente manual y una insignia de índice, relación de panel 1:1 o 3:4, cuatro transiciones (fundido / empuje a la izquierda / empuje a la derecha / zoom), intervalo de 3 a 60 s, subcarpetas incluidas por defecto. La foto inicial se semilla según la hora (nunca siempre la misma), la siguiente se precarga, y añadir/eliminar/cambiar el nombre de archivos en el vault actualiza la lista en el sitio sin perder tu posición
- **Music** — Busca y reproduce canciones gratuitas de NetEase Cloud Music desde la barra lateral: inicio de sesión opcional con cuenta de NetEase en la configuración para canciones de membresía autorizadas por la cuenta, pega un enlace de playlist para importarla, controles de volumen y repetición, playlist persistente con relleno diferido de portadas, y una barra opcional de mini reproductor flotante que sigue funcionando con el dashboard cerrado (solo escritorio)

La barra lateral también alberga la **tira de calendario semanal** (7 días compactos, hoy resaltado), los **documentos recientes** y el botón de **volver arriba**; los teléfonos obtienen la misma barra de widgets, y los datos de los widgets se combinan por unión entre dispositivos.

### 🎨 Banner
Un banner personalizable con una cita inspiradora y una imagen de fondo opcional. Admite tanto imágenes locales del vault como URLs web. Doble clic para editar.

### 🔄 Drag & Drop
Arrastra tarjetas entre secciones para reorganizar tu espacio de trabajo. Arrastra elementos de tarea dentro de las tarjetas Todo para reordenarlos. Arrastra enlaces de documentos entre tarjetas de proyecto/nota.

### 🧩 Secciones personalizadas
**15 tipos de secciones** para combinar a tu gusto — **Todo**, **Memo**, **Sticky Notes**, **Notes (tarjetas de proyecto)**, **Notes (sin portada)**, **Dataview**, **Library**, **Folder**, **Images**, **Videos**, **Calendar**, **Weread**, **TickTick**, **Web** y **RSS** — cada una con su propio diseño y comportamiento, para que el tablero se adapte a tu flujo de trabajo.

### 🕐 Documentos recientes
La barra lateral muestra los archivos editados recientemente con marcas de tiempo relativas, para que puedas volver a tu trabajo más reciente.

## Temas

![Themes Preview](screenshot2.png)
![Themes Preview](screenshot3.png)

13 temas hechos a mano, cada uno con una identidad visual propia:

| Tema | Estilo |
|-------|-------|
| **Earth** | Sol toscano: pergamino con lavados cálidos a la deriva de 32 s, acento terracota y notas oliva |
| **Nordic** | Fiordo polar: lavados de aurora helada sobre blanco frío, acento verde glaciar |
| **Pony** | Arcoíris de alta saturación inspirado en MLP: seis bandas de aurora de caramelo sobre un cielo nocturno, un tono pony por sección |
| **Blossom** | Brillo de cristal rosa, secciones transparentes |
| **Lilac** | Lecho impresionista: lavados a la deriva de 28 s tras tarjetas de marfil translúcidas, acento glicina |
| **Island** (predeterminado) | Pasteles estilo Animal Crossing, verde bosque y azul océano |
| **Tundra** | Gris frío + aurora verde aguacate, tarjetas de cristal salvia |
| **Matcha** | Estética de tazón de té: lavados de jardín de té de 26 s, tarjetas de cerámica crema, acento matcha profundo con notas doradas |
| **Vermilion** | Minimalismo de tinta: fondo de papel de arroz y tinta sumi, deriva de lavado de tinta de 40 s, un único acento de sello cinabrio |
| **Neon** | Casi negro con acento magenta neón, idéntico en modo claro y oscuro |
| **Volt** | Casi negro con acento cian eléctrico, idéntico en modo claro y oscuro |
| **Magma** | Casi negro cálido con acento naranja lava, idéntico en modo claro y oscuro |
| **Onyx** | Negro puro con acento limón, idéntico en modo claro y oscuro |

Todos los temas admiten tanto el modo claro como el oscuro de Obsidian.

## Configuración

- **Archivo del dashboard** — personaliza la ruta del archivo para los datos de tu dashboard
- **Estilo** — elige entre 13 temas visuales
- **Idioma** — interfaz en inglés o chino
- **Número de documentos recientes** — controla cuántos archivos recientes aparecen
- **Widgets de la barra lateral** — Weather, Heatmap, Pomodoro, Reading, Countdown. Activa/desactiva y configura cada widget de forma independiente
- **Ajustes de lectura** — Activa el registro de lectura, habilita/deshabilita el sonido al completar una sesión

## Instalación

### Desde los plugins comunitarios de Obsidian
1. Abre Ajustes > Plugins comunitarios
2. Explora y busca "Apex Dashboard"
3. Haz clic en Instalar y luego en Activar

### Instalación manual
1. Descarga la última versión desde [GitHub Releases](https://github.com/pandorareads/apex-dashboard/releases)
2. Extrae el contenido en la carpeta `.obsidian/plugins/apex-dashboard/` de tu vault
3. Abre Ajustes > Plugins comunitarios y activa "Apex Dashboard"

## Uso

1. Abre el dashboard mediante el icono de la cinta (icono de casa) o la paleta de comandos: `Apex Dashboard: Open dashboard`
2. Se crea automáticamente un archivo `dashboard.md` en la raíz de tu vault
3. Todos los cambios se guardan directamente en el archivo — son tus datos, en texto plano

> **Nota:** Eliminar, renombrar o reordenar secciones debe hacerse editando directamente el archivo `dashboard.md`. Cualquier cambio realizado en la nota surtirá efecto inmediatamente en la vista del dashboard.

## ☕ Invítame a un café

Si Apex Dashboard hace más fluido tu flujo de trabajo diario en Obsidian, considera invitarme a un café para apoyar el desarrollo continuo.

<p align="center">
  <img src="buy-me-a-coffee.png" alt="Buy Me a Coffee" width="640">
</p>

## Novedades

### 3.8.8
- **Archivo del pipeline reforzado** — Al archivar, ahora primero se mueve el archivo, se verifica que el renombrado realmente se aplicó (con un reintento automático) y solo entonces se marca el estado: los fallos silenciosos de movimiento en vaults sincronizados con iCloud ya no dejan una nota medio archivada varada en su carpeta de etapa (cuatro casos diagnosticados). Un movimiento fallido avisa y deja la tarjeta en el tablero, de modo que un clic más simplemente reintenta. Los movimientos por arrastre entre etapas reciben la misma protección
- **Corregido el reordenamiento por arrastre de botones de habilidad en tarjetas** — Causa raíz encontrada: incluso con el arrastre nativo de la tarjeta cancelado, Chromium sigue liberando la captura de puntero del botón, lo que elimina los listeners locales de movimiento/soltado del botón en cuanto el puntero sale de los 22 px del botón — justo lo que un reordenamiento entre botones necesita. El gesto ahora viaja sobre listeners de captura a nivel de documento: intercambio en vivo durante el arrastre, orden persistido al soltar, y soltar sobre otro botón de habilidad ya no puede abrir su modal por accidente
- **Botones de lanzamiento personalizados en tarjetas de la biblioteca de habilidades** — El menú de la tarjeta incorpora "Configurar botones de lanzamiento…": elige cualquier agente, etiqueta, icono, plantilla de prompt e interruptor de envío directo por habilidad. Los botones personalizados se muestran junto a los botones automáticos de origen — las habilidades de carpetas personalizadas (que no vinculan ningún agente) por fin tienen un punto de envío, persistido con la sección
- **Diseño del modal de configuración del pipeline** — El selector de agente es una ranura estrecha fija junto al campo de nombre de habilidad (el texto largo de la opción "próximamente" ya no desbarata la fila), y las plantillas de prompt ganan una ventana emergente de texto completo — lee y edita todo el contenido en una única ventana alta con los cambios transmitidos en vivo
- **Espacio libre inferior del dashboard** — Al llegar al final del scroll, la última sección y el botón de añadir sección ahora se elevan por encima de una ventana de chat de IA acoplada abajo (60 → 200 px en escritorio); los teléfonos y el diseño inmersivo conservan sus propios valores

### 3.8.7
- Localización en chino tradicional; el tema Blossom reconstruido como Barbie; corrección del solapamiento de mosaicos inmersivos, renderizado progresivo para secciones de pipeline/PM, y eliminación del carril de secciones en móvil — consulta las notas de la versión 3.8.7

### 3.7.1
- **Sección RSS totalmente nueva** — Suscríbete a cualquier fuente RSS 2.0 / Atom y todas las fuentes fluyen juntas en un único flujo cronológico inverso: puntos de no leído y filtro de no leídos, agrupaciones por grupo o por fuente (lista de grupos gestionable, creación directa desde una fila de fuente), y paginación con tamaño de página configurable (10/20/50/100). Haz clic en un artículo para leerlo en un modal de lectura temático — las fuentes de solo resumen tienen su página completa descargada y el contenido principal extraído automáticamente, con degradación al resumen más un botón para abrir en el navegador. Cada artículo se guarda en el vault como nota con un clic (el frontmatter refleja la plantilla de bandeja de entrada 「01 收集」, alimentando el pipeline PARA), y las entradas guardadas saltan directamente a su nota. Incluida la importación OPML (las categorías se convierten en grupos, con desduplicación de URLs) y la exportación. Las fuentes se cachean localmente durante 30 minutos (las fuentes fallidas reintentan a los 5, con una concurrencia cortés de cuatro) y las fuentes con fallos se nombran por fila con su motivo en el modal de configuración. La retención de marcas de leído es un ajuste (30/90/180/365 días o para siempre)
- **Correcciones de legibilidad del diseño inmersivo** — el texto de los campos invisible en sesiones claras de Obsidian (las reglas de inputs de Obsidian prevalecían sobre las del plugin) y los títulos de columnas kanban lavados en blanco (faltaba --db-bg en el bloque de variables inmersivas) corregidos de raíz; los botones de icono pequeños en secciones y modales ya no se repintan ni aplastan por el estilo nativo de botones de Obsidian
- **Las categorías predefinidas de gastos son editables** — los presets ahora se comportan exactamente como los personalizados: eliminar, reordenar y mapeo de grupos para todos; el historial sigue mostrándose bajo etiquetas eliminadas y los nombres liberados pueden volver a añadirse; cada dirección conserva al menos una categoría
- **Menú contextual inmersivo recortado** — desaparece la entrada de "ordenar diseño", poco efectiva; permanece "eliminar tarjeta"

### 3.7.0
- **Diseño de espacio de trabajo inmersivo totalmente nuevo** — cada espacio de trabajo puede cambiar a un modo inmersivo: un fondo de póster a sangre completa con reloj y barra de captura centrada, y cada widget, memo y todo como tarjeta de cristal libremente movible — redimensiona desde los bordes, alinea con ajuste inteligente. Crea uno desde el botón + del conmutador de espacios de trabajo

### 3.6.6
- **Temas guardados del Estudio de apariencia** — los aspectos personalizados se guardan como temas con cambio de un clic, además de una entrada de comando rápido
- **Escudos contra el secuestro de campos de entrada** — fragmentos de terceros ya no pueden secuestrar los campos de entrada del dashboard con estilos globales
- **Corrección de salto silencioso en Music** — los fallos ocasionales de reproducción de NetEase ya no se saltan en silencio; primero notifican por causa
- **Techo de renderizado elevado** — el renderizado progresivo por grupos ahora se limita a 500 elementos, de modo que las secciones muy grandes muestran más de sí mismas

### 3.6.5
- **Eliminar tarjetas en el sitio** — Las tarjetas de cuadrícula, galería y kanban en secciones de base de datos/carpeta muestran un botón de basurero en la esquina al pasar el cursor (siempre visible en móvil) — se acabó excavar en menús
- **Nueva nota desde múltiples plantillas** — El ajuste de "plantilla de nueva nota" ahora acepta múltiples plantillas; elige una en cada clic del "+" de la barra de herramientas, y la nota viene prellenada con los filtros de la sección. Los ajustes de plantilla única migran automáticamente
- **Control de columnas de la vista de tabla** — Un botón de ojo en la barra de herramientas lista todos los campos de propiedades: oculta los que no necesites y arrastra para reordenar, recordado por sección; los ajustes de columnas heredados migran automáticamente
- **Protección de renderizado para vaults grandes** — Las vistas agrupadas y kanban se renderizan progresivamente (50 por grupo/columna con una píldora de "mostrar más") y se limitan a 2000 elementos con un aviso — las secciones con miles de archivos ya no congelan el dashboard
- **Aniversarios lunares** — Las fechas de aniversario pueden ser lunares (almacenadas como fechas solares sin pérdida); los recordatorios se mapean a aniversarios lunares
- **Puntos focales de portada y banner** — Las portadas de proyecto y los fondos del banner permiten arrastrar para elegir el punto focal, recordado por imagen en rotación
- **Horas y destino de las tareas del calendario** — Las tareas admiten campos de fecha de inicio/fecha límite/programada con horas opcionales a lo largo de varios días (`[start::]`/`[due::]`/`[scheduled::]`); un modo de destino de "una nota por tarea" crea/añade automáticamente una nota fechada
- **Secciones sin portada fusionadas en Notes** — El tipo "notas sin portada" se fusiona en "Notes" con un interruptor de "mostrar portadas" por sección; las configuraciones antiguas migran automáticamente
- **Filtros de propiedades para secciones de carpeta** — Las secciones de carpeta incorporan el mismo editor de filtros de propiedades que las secciones de base de datos (igual/contiene/noIgual)

### 3.6.3
- **Agrupación para vistas de biblioteca/carpeta** — Las vistas de cuadrícula, galería, lista y tabla incorporan un botón de "Grupo" en la barra de herramientas: sin agrupación, por carpeta (carpetas de primer nivel bajo las carpetas de escaneo) o por cualquier propiedad de frontmatter; la elección persiste por sección en el archivo del tablero; la vista kanban conserva su agrupación mediante diálogo de configuración
- **Expandir/contraer todos los grupos** — Con la agrupación activa, las secciones de biblioteca/carpeta incorporan un botón en la barra de herramientas que expande o contrae todos los grupos de un clic; el icono y la descripción emergente siguen el estado actual
- **Área de widgets redimensionable** — Diseño lateral: arrastra el borde de la barra lateral para redimensionar su ancho (180–420 px, recordado); diseño apilado: arrastra la tira de widgets para fijar su altura (240–560 px); los niveles de altura de los widgets de hábitos y lectura (completa / dos tercios / media / un tercio) se seleccionan en los ajustes
- **Corrección de reproducción del widget de música** — Los fallos intermitentes de derechos -110 de NetEase ahora reciben reintentos espaciados antes de rendirse, de modo que las canciones con derechos dejan de saltarse; las canciones realmente no reproducibles se identifican con su nombre y motivo (membresía, compra o derechos regionales) en un aviso antes de avanzar — no más saltos silenciosos
- **Archivado de un clic a la nota diaria de hoy** — Un nuevo ajuste de "Destino de archivado": el archivo fijo (como antes) o la nota diaria de hoy (creada automáticamente a partir de la plantilla del plugin Daily notes cuando falta); el archivado se aborta con un aviso si no se puede resolver la nota diaria
- **Plantilla personalizada para guardar memos** — Guardar una tarjeta de memo/sticky como nota ahora admite una plantilla personalizada
- **Corrección de rendimiento de la actualización** — Los cambios del vault reconstruyen solo las secciones cuyo alcance de escaneo cubre la ruta modificada: editar notas en otro lugar, eliminaciones de RSS y churn de imágenes ya no hacen parpadear todas las secciones de biblioteca/carpeta; una sección cuyos resultados de consulta no cambian se salta la reconstrucción por completo (ediciones fuera de alcance: 3 secciones por pasada → 0)
- **Posición de scroll conservada en todo** — Las re-renderizaciones completas toman una instantánea del estado de scroll de toda la página (el scroll horizontal del mazo apilado de widgets, la región de scroll, los mazos de tarjetas, las listas de tareas, las listas internas de widgets) y la reproducen exactamente después; las claves basadas en anclas sobreviven a los reordenamientos de secciones/widgets — donde estabas trabajando es donde te quedas, no más saltos al inicio

### 3.6.2
- **Esquemas de color y presets del Theme Studio** — Cada área de color incorpora un desplegable de esquema (seguir tema / claro / oscuro / personalizado, la receta de primer plano para fondo de widget) con presets por campo para una selección rápida
- **Nueva nota en secciones de notas** — Las secciones de notas con y sin portada incorporan un botón de "nueva nota" por tarjeta, además de ajustes de sección para la plantilla de nueva nota y la carpeta de guardado (raíz del vault si no se define)
- **Las tarjetas de memo renderizan markdown** — Las tarjetas de memo y sticky renderizan su cuerpo mediante el renderizador de Obsidian (adaptación que conserva saltos de línea, los memos existentes mantienen su aspecto)
- **Corrección** — La plantilla de nueva nota de la sección de carpeta se descartaba silenciosamente al guardar los ajustes; el frontmatter de la plantilla ahora se fusiona bajo las propiedades del filtro conservando las líneas en bruto

### 3.6.1
- **Las barras de herramientas de secciones se colapsan en botones desplegables** — El conmutador de vistas y los controles de tamaño de tarjeta (S/M/L) en las secciones de biblioteca/carpeta/imagen/video se colapsan cada uno en un solo botón que muestra la elección actual; al hacer clic se abre el menú nativo para elegir — una barra de herramientas mucho más silenciosa
- **Alcance de visualización de imágenes/videos** — Un nuevo ajuste de "Alcance de visualización": selección múltiple de carpetas del vault (con selector); cuando se define, solo se muestran los archivos bajo ellas (las exclusiones siguen aplicándose dentro del alcance); vacío = todo el vault
- **Plantilla de nueva nota por sección** — Los diálogos de configuración de carpeta/biblioteca incorporan una "Plantilla de nueva nota": las notas creadas desde el "+" de la barra de herramientas parten del cuerpo de la plantilla ({{title}} y {{date:…}} sustituidos) con las propiedades de filtro de la sección aún prellenadas; si falta la plantilla, se degrada a una nota vacía
- **Destino de las tareas del calendario** — Los ajustes del calendario incorporan un "Destino de tareas": mantener la cadena por defecto (nota diaria del día → lista de todos del dashboard), o fijar un archivo específico (insertar arriba/abajo) o una carpeta (una nota YYYY-MM-DD por día, creada automáticamente)
- **Los botones de acciones rápidas son de cristal en todos los temas** — Los rellenos y bordes de botones de Earth/Nordic/Island/Tundra/Matcha/Lilac/Vermilion/Aurora son ahora cristal translúcido teñido con el acento, igualando los cinco temas que ya lo tenían — los doce se sienten igual
- **Alfa del Theme Studio y fondo de página corregidos** — Cada fila de color incorpora un deslizador de opacidad (0–100%); el fondo de página personalizado ahora realmente se aplica (los degradados de temas de lavado también se sustituyen) y el alfa 0 revela el fondo de Obsidian
- **Panel interior esmerilado en tarjetas con imagen de fondo** — Con una imagen de fondo definida, un panel de cristal esmerilado distintivo flota sobre la foto (desenfoque real + relleno de tarjeta del tema + borde superior iluminado); el widget pomodoro se une al club de imagen de fondo (engranaje en su grupo de fila superior)
- **Muchos refinamientos** — El marcador del banner contraído se retrae hasta pasar el cursor; se eliminó el botón de paleta de acciones rápidas (las imágenes + colores de primer plano lo sustituyen); los botones del encabezado de hábitos siempre visibles; el color de primer plano personalizado ahora también invierte el texto heredado (etiquetas de acciones rápidas corregidas); corregido el widget lunar que perdía el reordenamiento por arrastre tras una actualización asíncrona (delegación de eventos); corregido el arrastre de ancho de pares roto en Windows (valor de compañero obsoleto con envolvimiento, redondeo de subpíxel y eventos absorbidos por el webview, las tres causas raíz)

### 3.6.0
- **Diseño apilado totalmente nuevo** — Ajustes → General → Diseño incorpora selección ilustrada: lado a lado (clásico) o apilado — los widgets se organizan en un mazo de tarjetas proporcional a la altura (completa / dos tercios / media / un tercio) bajo el banner, la barra de notas rápidas permanece fija, los widgets y secciones se desplazan como una única página, fijar/contraer sin cambios; los teléfonos no se ven afectados
- **Fondos de widgets y esquemas de primer plano** — Aniversario, cuenta regresiva, progreso del año, música, hábitos y acciones rápidas admiten fondos personalizados (el selector de imágenes lista solo imágenes, se aceptan URLs de imágenes en red) con deslizadores de opacidad / atenuación / desenfoque y colores de primer plano claro / oscuro / selector personalizado; el engranaje en la esquina de la tarjeta los cambia sin salir del dashboard
- **Nuevo widget de Aniversario** — Tiempo transcurrido desde una fecha histórica (precisión de años-meses-días / días totales / días+horas), recordatorio opcional cada año el mismo día, selector de fechas nativo
- **Widget de álbum multi-instancia** — Añade cualquier número de álbumes, cada uno con su propia carpeta y tamaño de tarjeta
- **Corrección: arrastre de ancho de pares roto en Windows** — Las tres causas raíz corregidas (envolvimiento de filas por valor de compañero obsoleto, redondeo de subpíxel, páginas incrustadas absorbiendo eventos del ratón mediante una protección de captura de puntero)

### 2.5.3
- **Reordenamiento de categorías y grupos principales** — El diálogo "Administrar categorías" ahora permite ordenar arrastrando (presets incluidos; el desplegable de entradas y los filtros del libro mayor lo siguen; los botones arriba/abajo cubren pantallas táctiles). Una nueva capa de grupo principal: crea grupos, asigna categorías, y el libro mayor incorpora una columna "Principal" además de un filtro de grupo (con una categoría "Sin agrupar"); la dona de estadísticas y el ranking alternan entre agregación por categoría y por grupo. La agrupación se almacena por separado, por lo que reagrupar recategoriza todo el historial sin tocar ningún registro
- **Historial por semana y mes** — El rango "Historial" de las estadísticas incorpora un subconmutador de semana/mes/año con paginación ‹ ›: ve cualquier semana pasada (etiquetada con su rango de fechas), mes o año; los deltas de KPI se comparan con el periodo equivalente anterior, y las tendencias se representan por día para semanas/meses y por mes para años; la paginación se detiene en el periodo actual y en el año más antiguo con datos
- **Corrección: las insignias de delta de KPI apretaban el número** — Las tarjetas de estadísticas de gastos y pomodoro ahora dan al valor su propia línea centrada, con la insignia de periodo sobre periodo ajustada y centrada debajo — no más compresión ni desbordamiento de la tarjeta

### 2.5.2
- **Autorreparación de la reproducción de música** — Un fallo transitorio ya no muestra "error de reproducción, saltando a la siguiente canción" y pierde la canción para siempre: reintenta en silencio la misma canción una vez con un enlace firmado nuevo (las caídas a mitad de flujo se reanudan en la misma posición, y los enlaces caducados durante una pausa larga se sustituyen por unos nuevos); solo si el reintento falla pasa sigilosamente a la siguiente. Quedan tres avisos accionables: hacer clic en una canción VIP, un inicio de sesión caducado y la parada por cortacircuitos tras fallos repetidos
- **Desplegable de fuente de la cita del banner** — No más escritura manual de nombres de fuente: elige de un desplegable con ocho tipografías chinas (KaiTi, Songti, Fangsong, Lishu, Xingkai, Yuanti, Heiti, LXGW WenKai) y ocho occidentales (Georgia, Times, Palatino, Baskerville, Garamond, Didot, Helvetica, Courier). Cada entrada almacena una pila de fuentes multiplataforma, de modo que un ajuste se renderiza igual en macOS, Windows e iPad; los nombres escritos a mano anteriormente permanecen seleccionables en el desplegable

### 2.5.1
- **Inicio de sesión con cuenta de NetEase** — En escritorio, abre la página oficial de NetEase desde Ajustes → Widgets → Music (inicio por teléfono o QR) y reproduce con los derechos de tu cuenta — las canciones de membresía y compradas se reproducen completas. Las credenciales van directamente a NetEase; la sesión vive en una partición Electron local del dispositivo, nunca en los datos del plugin ni en la sincronización del vault, y se borra al cerrar sesión. El uso anónimo no cambia
- **Mover tarjetas entre secciones** — Arrastra la barra de título de una tarjeta para moverla entre Todo, Memo y Sticky; las tareas y estados de verificación sobreviven a las conversiones Todo↔Memo y los enlaces de notas viajan con ellas; las tarjetas de nota (con o sin portadas) también pueden entrar en las tres secciones
- **Fuente de la cita del banner** — Junto al selector de color de la cita, un nombre de fuente personalizado (p. ej. KaiTi, Georgia) ahora da estilo a la línea de cita y autor; restablecer vuelve a la fuente por defecto del tema
- **Secciones de biblioteca/carpeta más altas en móvil** — Altura de fila 50vh→60vh más una barra de herramientas más delgada (conteo/tamaño de página recogidos): la vista de cuadrícula muestra 3-4 tarjetas en teléfonos convencionales. Tablets y escritorio sin cambios
- **Corrección: tarjetas arrastradas que ocasionalmente desaparecían** — Se endureció la resolución del destino de soltado y el orden de escritura; las tarjetas ya no desaparecen tras un arrastre entre secciones seguido de recarga

### 2.5.0
- **Widget de Álbum de fotos** — Señálalo a una carpeta del vault y rota por las imágenes como un marco de fotos digital: pasa el cursor para pausar, anterior/siguiente manual (que rearma el temporizador automático para que nunca salte doble), insignia de índice, relación de panel 1:1 o 3:4, cuatro transiciones (fundido / empuje a la izquierda / empuje a la derecha / zoom) impulsadas por un ping-pong de dos capas, intervalo de 3 a 60 s, subcarpetas incluidas por defecto. La foto inicial se semilla según la hora, la siguiente se precarga, y añadir/eliminar/cambiar el nombre de archivos en el vault actualiza la lista en el sitio — una foto actual que sobrevive sigue reproduciéndose sin interrupción
- **Widget de Música** — Busca y reproduce canciones gratuitas de NetEase Cloud Music en la barra lateral: inicio de sesión opcional con cuenta de NetEase en la configuración para canciones de membresía autorizadas por la cuenta, importación de playlists desde un enlace, controles de volumen y repetición, playlist persistente con relleno diferido de portadas, y una barra opcional de mini reproductor flotante que sobrevive al cierre del dashboard (solo escritorio)
- **Corregido: los controles dentro de los widgets activaban el arrastre para reordenar** — Los widgets de la barra lateral eran arrastrables como un todo, así que presionar y arrastrar un deslizador de volumen, un campo de texto, un selector o un botón se interpretaba como un gesto de reordenamiento (más visible en el volumen del panel de música). El arrastre ahora se arma por gesto: presionar un control de formulario o botón lo deja desactivado, presionar la superficie lisa del widget lo activa — consistente en todos los widgets
- **Modal de anuncio** — Retitulado a "2 secciones + 2 widgets" y ahora presenta los widgets de álbum y música junto a las secciones de calendario y web

### 2.4.1
- **Tema Vermilion (antes Mono, renacido)** — La funesta pareja de negro/blanco puro queda curada: un cálido fondo de papel de arroz y tinta sumi con subtono azul sustituyen a los grises neutros, una deriva de lavado de tinta de 40 s (la más lenta de todos los temas) respira tras las tarjetas, y un único acento rojo sello de cinabrio (enlaces, casillas, foco, progreso) aterriza como el sello sobre un pergamino — la pareja de negro/blanco permanece, el ambiente pasa de funeral a estudio
- **Tema renombrado** — Mono ahora es Vermilion; las instalaciones existentes mantienen su selección intacta
- **Orden de los temas** — Blossom y Lilac se movieron después de Pony, Vermilion después de Matcha; el desplegable, el comando de ciclo y la tabla del README están sincronizados

### 2.4.0
- **Cinco temas renacen** — Pony, Lilac, Earth, Nordic y Matcha incorporaron todos fondos de lavado a la deriva lentos (26–32 s, respirando más que luciéndose; fijado automáticamente en móvil y con movimiento reducido) más un seguro de modales opacos (no más diálogos blancos sobre blanco en bases claras de Obsidian)
- **Pony (antes Aurora)** — Arcoíris MLP de alta saturación: seis bandas de aurora de caramelo ciclando sobre un cielo nocturno, y cada sección luce su propio tono pony en el título (memo=rosa Pinkie, todo=ámbar Applejack, notes=mantequilla Fluttershy, projects=azul Rainbow Dash, library=violeta Twilight…), con brillos de hover de tarjetas a juego y un degradado de progreso de caramelo
- **Lilac** — Lecho impresionista: acuarelas de glicina/rosa/marfil a la deriva durante 28 s tras tarjetas de marfil translúcidas, con un acento glicina que por fin se distingue del fondo
- **Earth** — Sol toscano: luz de miel/terracota/oliva arrastrándose por el pergamino durante 32 s, secciones de cristal cálido sobre tarjetas de crema sólido, acento terracota
- **Nordic** — Fiordo polar: aurora de azul escarcha/cian hielo/índigo/menta sobre blanco frío, acento verde glaciar — las losas planas de pizarra desaparecieron
- **Matcha** — Estética de tazón de té: lavados de jardín de té tras tarjetas de cerámica crema translúcidas, acento matcha profundo claramente separado del fondo salvia (antes eran casi idénticos), notas doradas por doquier
- **Corrección global** — Cuatro estados activos púrpura codificados (tarjetas de añadir sección, opciones de weread…) ahora derivan del acento de cada tema; todos los temas se benefician

### 2.3.0
- **Sección Calendar** — La vista ampliada del calendario de la barra lateral incrustada directamente en el tablero: cuadrícula mensual completa (eventos multidía como barras continuas) y cuadrícula semanal con horas, conmutación mes/semana, filtro de tareas y un salto a Hoy. Pasa el cursor sobre una fecha para ver la lista completa de tareas del día; haz clic en un número de fecha para añadir una tarea a ese día (escrita en la nota diaria o en la lista de todos del dashboard). Las tareas agregan todo el vault y la cuadrícula se actualiza en el sitio a medida que cambian las notas.
- **Sección de incrustación Web** — Fija cualquier página web al tablero: introduce una URL y se incrusta. El modo automático comprueba previamente la política de enmarcado del sitio — los sitios enmarcables cargan como iframe, los que lo rechazan cambian a un webview de escritorio (inicio de sesión persistente; ideal para Google Keep o TickTick web), y en móvil se muestra una tarjeta de respaldo con un botón para abrir en el navegador. Se admiten el bloqueo manual de iframe/webview y un zoom de 0,5–2x.
- **Corrección: el diálogo de confirmación de borrado oscurecía la pantalla con cada pulsación de Enter** — El diálogo nunca reclamaba el foco ni las teclas, así que cada Enter reactivaba el botón de borrado aún enfocado debajo y apilaba otra capa media negra. Ahora enfoca el botón seguro por defecto al abrirse con semánticas claras de Enter/Escape — no más apilamiento.

### 2.2.0
- **Vista de galería** — Las secciones de biblioteca y carpeta incorporan una vista de galería: las tarjetas muestran imágenes de portada (de los campos `封面`/`cover` o cualquier valor con forma de imagen) con un conmutador de tamaño S/M/L en la barra de herramientas, persistido por sección; el nivel pequeño encuadra las portadas 1:1, medio/grande mantienen 16:10
- **Memoria de tamaño de medios** — Las secciones de imágenes/videos recuerdan su elección de tamaño de miniatura entre recargas y reinicios
- **Propiedades fijadas en tarjetas** — Elige exactamente qué campos de frontmatter se muestran en las tarjetas (claves comunes fijadas primero, claves escaneadas del vault, más adiciones personalizadas), complementando la alternativa de conteo máximo
- **Configuración de carpeta: búsqueda de etiquetas** — Un cuadro de búsqueda en la sección de filtro de etiquetas para ubicar rápidamente cuando el vault tiene muchas etiquetas
- **Correcciones** — Botón de cierre duplicado en el popover de notas bajo Obsidian 1.13+; endurecimiento de la posición de inserción de tareas del calendario, renderizado del número de día, selector de rutas y mapeo de símbolos del clima

### 2.1.2
- **Island se convierte en el tema por defecto** — Las nuevas instalaciones comienzan con la paleta pastel estilo Animal Crossing; dos nuevas imágenes de banner por defecto
- **Mapa de calor del pomodoro reubicado** — En el modal de estadísticas, el mapa de calor ahora se sitúa por encima de la línea de tiempo de hoy
- **Scroll conservado al editar** — Las actualizaciones en el sitio tras editar tarjetas ya no saltan al inicio

### 2.1.1
- **Relleno retroactivo de hábitos** — Un icono de reloj en el widget de hábitos abre un diálogo de relleno retroactivo para los registros de ayer (marca individualmente o selecciona todos los perdidos)
- **Nuevos todos arriba** — Los elementos de todo recién añadidos se colocan al inicio de la lista
- **Espaciado del banner** — Espacio más reducido entre el banner y el contenido

### 2.1.0
- **Multi-espacio de trabajo** — Varios dashboards en un solo vault: cada espacio de trabajo tiene su propio archivo de dashboard y configuración; un conmutador numérico en la esquina superior izquierda del banner salta entre ellos; la página de ajustes ofrece reordenamiento por arrastre, renombrado y redirección de rutas, también en móvil

### 2.0.0
- **Vistas agrupadas más compactas** — Canalizaciones más densas en las vistas agrupadas de biblioteca/carpeta para acomodar más tarjetas por pantalla
- **Grupo derecho de la barra de herramientas** — Los controles de conteo y paginación se alinean uniformemente al borde derecho
- **Nuevo código QR del grupo comunitario**

### 1.9.6
- **Libro mayor de gastos** — "Ver todo" desde el modal de estadísticas abre una tabla completa estilo Excel de todos los registros: filtros de tipo/categoría/rango de fechas/texto, ordenación de columnas, edición de filas, borrado por lotes confirmado, importación CSV (las categorías desconocidas se registran automáticamente) y exportación, páginas de 50 filas con totales filtrados
- **Categorías de gastos personalizadas** — "+ Nueva categoría…" / "Administrar categorías…" en cada desplegable de categorías; listas por dirección con conteos de uso, colores de gráficos deterministas, seguro para la sincronización
- **Los datos de widgets se sincronizan entre dispositivos** — Los datos de hábitos, pomodoro, lectura y gastos se releen y combinan por unión al enfocar la ventana / al pasar a primer plano en móvil; cada guardado fusiona primero las escrituras ajenas, de modo que los registros hechos en otro dispositivo sobreviven (las eliminaciones nunca resucitan)
- **Modal de estadísticas: diseño alineado de dos columnas** — KPIs + lista de registros a la izquierda, las cuatro secciones de gráficos apiladas a la derecha; colapso por container-query a una columna en paneles estrechos (corrige el solapamiento de zonas); subrayado estilo libro mayor bajo los campos de importes
- **Las portadas de lectura aceptan rutas de imágenes locales/del vault** — http(s), `data:`, rutas del vault y rutas locales de escritorio; los mini paneles flotantes son arrastrables y la píldora del pomodoro puede desactivarse; el calendario a pantalla completa recuerda su filtro de tareas

### 1.9.5
- **Widget de registro de gastos** — Registro rápido de gastos/ingresos en la barra lateral de escritorio y la barra de widgets del teléfono, con notas, entradas retroactivas, totales de hoy y una capa de estadísticas por semana/mes/año/histórico total
- **Widget de calendario para teléfono** — Cuadrícula de mes/semana, agendas diarias y la vista de mes a pantalla completa en la barra de widgets móvil; las fechas programadas (`⏳`) y de finalización (`✅`) anclan las tareas a sus días, y los tramos multidía se representan como barras continuas

### 1.8.7
- **Sección Sticky Notes (便利贴)** — Memos y todos lado a lado en una sola sección: el botón de añadir abre un selector de tipo (icono + descripción); las tarjetas de memo conservan el color de paleta, guardar como nota y edición en línea, las tarjetas de todo conservan la lista de tareas y el progreso — más un archivado de un clic para tareas completadas. El estilo de la sección sigue al de la sección de todos
- **Tamaño de texto global** — Pequeño / Mediano / Grande en el Theme Studio escala todo el dashboard proporcionalmente
- **Filtro rápido de fechas de la biblioteca** — Fichas de "Ventana móvil de N días" junto al rango de fechas fijo
- **Carpetas excluidas del calendario mediante un selector de carpetas de selección múltiple** — la selección de un padre cubre todas las subcarpetas
- **Dataview `WITHOUT ID` y "Vista libre"** — elimina la columna de archivo en `LIST`, y permite a cada tipo de consulta renderizar en su forma nativa
- **Los widgets de la barra lateral sobreviven a las ediciones del dashboard** — la tira de widgets se vuelve a adjuntar en lugar de reconstruirse, así el calendario permanece en el mes abierto y las cuentas regresivas siguen corriendo

### 1.8.5
- **Comandos rápidos en la barra de Acciones comunes** — Un cuarto tipo de ficha en la barra superior fija: ejecución de un clic de cualquier comando de Obsidian (núcleo o plugin). Añade comandos mediante una búsqueda con filtro en vivo sobre todo el registro de comandos del vault, luego renombra, cambia el icono y reordena arrastrando cada uno en el modal de configuración de la barra. Un comando obsoleto (plugin deshabilitado o eliminado) muestra un aviso en lugar de fallar en silencio

### 1.8.4
- **Corrección: diseño de la pestaña de ajustes roto en Obsidian 1.13+** — El puente de ajustes exponía cada módulo como una subpágina navegable, de modo que la nueva interfaz de ajustes de Obsidian los dispersaba en páginas separadas y comprimía las filas lateralmente. La pestaña es ahora una única página vertical, idéntica al diseño previo a 1.13, y un bug de doble renderizado desapareció

### 1.8.2
- **Anuncio de Dataview + grupo comunitario** — Una ventana emergente única tras la actualización presenta la nueva sección Dataview y te invita al grupo de usuarios de WeChat (código QR incluido; si la invitación ha caducado, añade el contacto de WeChat `PandoraReads`)
- **Corrección: wikilinks con subrutas de encabezado/bloque** — `[[note#heading]]` y `[[note#^block]]` en memos y secciones Dataview ahora saltan al ancla misma, no solo abren la nota: la ruta de la pestaña se resuelve mediante el texto del enlace nativo, el popover de notas hace scroll con `setEphemeralState`, y las vistas previas al pasar el cursor muestran la posición del ancla

### 1.8.0
- **Estadísticas de enfoque, rediseñadas como un dashboard horizontal** — El popup de estadísticas del pomodoro es ahora una vista de tres columnas: KPIs (progreso del objetivo, enfoque de hoy, puntuación de eficiencia, interrupciones, adherencia a los descansos, rachas), dona de distribución temporal con un gráfico de tendencia adaptativo (horas/días/meses según el rango, línea base discontinua del objetivo diario, barras de día clicables que profundizan en los registros de esa fecha), ranking de actividades que filtra la tendencia, un mapa de calor de degradado de 12 semanas, y una línea de tiempo de hoy que muestra el ritmo trabajo→descanso. Rangos Día/Semana/Mes/Año/Todo en periodos naturales, columna única adaptable por debajo de 900 px
- **Objetivo diario de pomodoro** — Fija un objetivo (deslizador en los ajustes, o el lápiz en la tarjeta principal de estadísticas); el progreso se muestra como `3/8` con una galga que reemplaza la dona cuando hay una sola actividad
- **Gestión de etiquetas de pomodoro** — Renombra, elimina, fusiona y fija etiquetas de actividad desde el engranaje del encabezado de estadísticas; el historial se reescribe en el sitio y las etiquetas fijadas encabezan la lista de selección rápida del widget
- **Datos de pomodoro v2** — La etiqueta de actividad actual persiste entre reinicios; los registros guardan los minutos reales de enfoque (excluyendo pausas), conteos de interrupciones y resultados de descansos (tomado/omitido); el ajuste de inicio automático del descanso ahora se respeta (las fases quedan en espera con un botón de Iniciar descanso / Reanudar enfoque)
- **Etiquetas de medios para secciones de imágenes y videos** — Etiqueta imágenes y videos individuales y filtra la sección por etiqueta; las ediciones desde la cuadrícula, la tabla o el lightbox se debounced y solo re-renderizan esa sección

### 1.7.0
- **Sección Dataview (motor DQL integrado)** — Un nuevo tipo de sección que ejecuta consultas al estilo Dataview sin plugin externo: `TABLE`, `LIST`, `TASK`, `CALENDAR` y `HEATMAP`, con `FROM`/`WHERE`/`SORT`/`GROUP BY`/`FLATTEN`/`LIMIT`, ~40 funciones, campos `file.*`, frontmatter YAML y campos en línea. Validación de sintaxis en vivo en el modal de configuración, ejemplos de un clic y un botón de actualización manual. La antigua sección Heatmap independiente es reemplazada por consultas `HEATMAP` (las secciones de mapa de calor existentes vuelven al estilo de proyecto de forma segura)
- **Botón de volver arriba** — Un botón flotante en la esquina inferior derecha devuelve el dashboard al inicio, con inserción de área segura en móvil
- **Contraer/expandir subtareas más rápido** — Tocar un cheurón para expandir/contraer subtareas (o documentos anidados) podía tardar varios segundos. Contraer es ahora una conmutación DOM silenciosa en el sitio sin re-renderizado completo, así que es instantáneo
- **Corrección: un padre contraído no podía expandirse tras cambiar un hermano** — Marcar una tarea hermana activaba un re-renderizado que dejaba a un padre contraído sin DOM de hijos, así que su cheurón parecía muerto. Los hijos ahora siempre se renderizan (ocultos mediante una clase), así que expandir funciona a través de re-renderizados, incluido el colapso anidado
- **Arrastre de tarjetas de memo más rápido (sin lag ni estela)** — Mover una tarjeta de memo solía reconstruir todo el tablero y partía la tarjeta arrastrada en una imagen doble a mitad de transición. Las tarjetas ahora se mueven reubicando físicamente su nodo DOM — los enlaces analizados y los bindings de hover permanecen intactos, el soltado es instantáneo
- **Resolución de wikilinks más rápida en vaults grandes** — Los enlaces que no coincidían por ruta exacta solían escanear todo el vault, una vez por enlace por render. Ahora se resuelven contra un índice de nombres base en caché mantenido sincronizado con los cambios de archivos — un escaneo completo del vault se convierte en una búsqueda hash

### 1.6.3
- **Corrección de fallo de toque en iOS** — En iOS, tocar el dashboard justo después de cargar podía bloquear Obsidian (la app se reiniciaba). Móvil ahora deshabilita por completo el desenfoque de fondo — varias capas de desenfoque seguían activas y, combinadas con el comportamiento de toque de iOS, excedían el límite de renderizado del WebView
- **Estadísticas del banner en teléfonos** — El banner de estadísticas ahora muestra solo la columna central en anchos de teléfono; las columnas laterales se recortaban antes

### 1.6.2
- **Vista de Estadísticas del banner** — Un nuevo modo del banner (conmuta en la parte superior del modal de la varita) que muestra un dashboard de tres columnas: **Escala** (notas totales + una tira de estadísticas), **Actividad** (racha de días + un mapa de calor de contribuciones) y **Productividad** (finalización de tareas / enlaces por nota / conectividad con barras de progreso). Cada métrica se calcula en vivo desde el vault
- **Configurable** — Mostrar/ocultar y estadística principal por columna, métricas de progreso de la columna derecha, deslizadores de desenfoque y oscuridad del fondo, color de acento, y una carpeta de notas diarias para la racha
- **Fondo desenfocado** — La imagen del póster permanece visible detrás del panel de estadísticas mediante un desenfoque ajustable + un velo oscuro
- **Corrección de persistencia** — La vista del banner y su configuración ahora sobreviven a recargas / actualizaciones del plugin (antes se restablecían a Póster)
- **Corrección de estadísticas en vivo** — Las estadísticas ahora se actualizan al editar (la actualización se omitía bajo la configuración por defecto)
- **El idioma por defecto es ahora 中文**

### 1.6.1
- **Correcciones de captura de Notas rápidas y soporte de plantillas** — Capturar hacia una nota de destino ahora añade al archivo existente en lugar de crear un archivo suelto sin extensión cuando la ruta omite `.md`; las nuevas notas creadas en la carpeta de captura pueden partir de una plantilla (nuevo ajuste "Plantilla para nuevas notas")
- **Marca de tiempo de captura más rica** — Las líneas capturadas llevan la marca de un enlace wiki de fecha + hora (`[[2026-08-09]] 14:30`) en lugar de solo la hora, de modo que puedas filtrar por todo el vault y la fecha enlaza con la nota diaria
- **Sección "Capture" renombrada** — Ahora "Fleeting Capture" en la configuración de Acciones comunes
- **Actualización del clima más rápida y desenfoque móvil más ligero** — La actualización del clima ahora actualiza las tarjetas en el sitio en lugar de reconstruir el dashboard; en móvil, el desenfoque de fondo de botones/tarjetas se elimina y el desenfoque de modales se limita a 6 px para menor carga de GPU

### 1.6.0
- **Guía de primera ejecución para la barra de Acciones comunes** — Una ventana emergente de bienvenida centrada al iniciar te guía por la nueva barra de herramientas y puede activarla con un clic. Se muestra una vez por versión
- **Arrastrar para reordenar botones de Notas rápidas** — Reorganiza los botones de creación/fijados arrastrando en el modal de configuración; el diseño de la barra de herramientas se refina (Hoy encabeza la tira, la zona de acciones se agrupa)
- **Corrección de plantilla de Daily Notes** — `{{date}}` y otras variables de plantilla ahora se sustituyen cuando el botón Hoy crea una nota, y la búsqueda de Daily Notes es más resiliente entre versiones de Obsidian
- **Validación de estantería y clave de Weread** — La paginación de estantería y el renderizado de la barra de progreso refinados; la clave de API se valida por adelantado (debe empezar con `wrk-`)

### 1.5.0
- **Appearance Studio** — Panel dedicado para personalización en vivo de color, imagen de fondo, opacidad de superficies, desenfoque de cristal y radio de esquinas
- **Barra de Acciones comunes** — Barra fija para creación de notas con un clic, notas fijadas y captura en línea
- **Copia de seguridad y restauración del dashboard** — Instantáneas periódicas del archivo del dashboard con restauración de un clic
- **Kanban estilo Trello** — Vista kanban para secciones de proyecto, además de varias correcciones y pulido

### 1.4.4
- **Ajuste de zona horaria de TickTick** — Una nueva zona horaria configurable (por defecto `Asia/Shanghai`) corrige los todos de hoy mostrando la hora/fecha incorrecta cuando la zona horaria de tu sistema difiere de la de tu cuenta de TickTick. Configúrala en Ajustes → TickTick → Timezone
- **Abrir notas directamente en una pestaña** — Nuevo ajuste (más un conmutador en la paleta de comandos) para omitir el popover del editor dentro del dashboard: hacer clic en una tarjeta de documento abre la nota en una pestaña inmediatamente. Desactivado por defecto para preservar el comportamiento existente del popover

### 1.4.3
- **Cumplimiento de la revisión del marketplace** — Correcciones de seguridad de tipos y calidad de código para que el plugin pase la revisión de plugins comunitarios de Obsidian: se eliminó el registro de depuración `console`, se sustituyeron los tipos `any` por tipados Electron adecuados en el inicio de sesión del navegador de TickTick, se añadieron ayudantes seguros de coerción de cadenas, y se corrigió el renderizado de secciones para construir nodos DOM desvinculados (una regresión que ocultaba todas las secciones de la barra lateral). Sin cambios de funcionalidad visibles para el usuario.

### 1.4.2
- **Skill de Weread v1.0.4** — El skill de Weread incluido se actualizó a `skill_version` 1.0.4
- **Corrección de importación de subrayados** — Importar los subrayados de un libro a una nota vuelve a funcionar
- **Interfaz del botón de importación** — Se renovó el botón de importación en la sección Weread

### 1.4.1
- **Conmutador de vista de TickTick** — Conmutación de vista lista/kanban para la sección TickTick
- **Pulido del mapa de calor** — Refinamientos visuales a la sección Heatmap
- **Correcciones de rendimiento** — Mejoras generales de renderizado y rendimiento
- **Eliminación de Ember** — Se eliminaron los restos de la interfaz "ember"

### 1.4.0
- **Nuevas secciones** — Tipos de sección Weread, TickTick y Heatmap
- **Reordenamiento y redimensionado de secciones** — Reordena secciones y ajusta sus alturas
- **Propiedades de tarjetas** — Tamaño, extensión en cuadrícula, color e imagen de portada por tarjeta

### 1.3.1
- **Soporte de múltiples carpetas** — Las secciones de medios, carpeta y biblioteca pueden apuntar a múltiples carpetas
- **Correcciones de interfaz** — Se eliminaron los botones de configuración duplicados en secciones de carpeta/biblioteca; se restauró el botón de eliminación de la sección de biblioteca

### 1.3.0
- **Correcciones de la revisión del plugin** — Se resolvió el feedback de la revisión de plugins comunitarios de Obsidian: soporte de ventanas emergentes mediante `activeDocument`, advertencias de soporte parcial de CSS, globals de ESLint, y seguimiento de la configuración de lint en CI

### 1.2.9
- **Vista semanal del calendario** — Nuevo conmutador Mes | Semana en la sección Calendar. La vista semanal en columna es una lista vertical compacta (ordenada por hora, con etiquetas de hora); la vista semanal del modal a pantalla completa es una cuadrícula de horas estilo Google Calendar (eje de horas + 7 columnas de días, tareas posicionadas/dimensionadas por hora, tira de todo el día, línea de "ahora"). Las horas provienen de recordatorios `⏰` y de `[due::]`/`[start::]`/`[end::]` con `HH:MM`
- **Añadir tareas desde el calendario** — Haz clic en un día → su agenda te permite añadir una tarea (con hora opcional) que se escribe en la nota diaria de ese día (creada automáticamente desde la plantilla/ruta de Daily Notes); con hora mediante `⏰`, solo fecha mediante `📅`
- **Eliminado: sección All Tasks** — Escaneaba cada archivo markdown del vault en cada render, lo que sobrecalentaba los teléfonos. La sección Calendar sigue cubriendo la agregación de tareas con fecha
- **Corrección de rendimiento y móvil** — Las miniaturas de video ya no filtran decodificadores de medios (corregida la memoria desbocada + sobrecalentamiento/congelación de teléfonos); en móvil renderizan marcadores de posición estáticos. Editar una nota ahora actualiza solo la sección afectada en el sitio en lugar de reconstruir todo el tablero (adiós al "la videoteca no deja refrescarse")
- **Video diferido (escritorio) + escaneo más rápido + GPU móvil** — Solo los mosaicos en pantalla montan un `<video>` real (IntersectionObserver); el escaneo de tareas del vault (Calendar) omite los archivos sin tareas y cede el paso a la interfaz; el desenfoque de cristal por tarjeta se deshabilita en móvil (≤640 px) para reducir la carga de GPU y el calor

### 1.2.8
- **Sección All Tasks** — Nuevo tipo de sección que agrega cada tarea con casilla de todo el vault (como una consulta `TASK` de dataview); búsqueda, filtro de estado y ordenación
- **Agrupación + kanban** — Agrupa tareas por fecha (Vencidas/Hoy/Esta semana/Más tarde/Sin fecha) o prioridad; vista de lista con grupos contraíbles, o tablero kanban con una columna por grupo
- **Escritura de vuelta de tareas** — Marca una tarea en la vista All Tasks o Calendar y actualiza la casilla en la nota de origen
- **Fechas límite y prioridad** — Lee fechas límite `⏰`, `[due::]`, `📅` y prioridades `[priority::]`
- **Sección Calendar** — Nuevo tipo de sección: cuadrícula mensual nativa de todas las tareas con fecha del vault, con una vista compacta en columna y un modal de calendario a pantalla completa; los eventos multidía (`[start::]`/`[end::]`) se extienden a lo largo de varios días
- **Excluir carpetas** — Las secciones All Tasks y Calendar pueden excluir carpetas del vault (p. ej. Archive/Templates) de la agregación

### 1.2.7
- **Conmutador de tamaño de miniaturas** — La vista de cuadrícula de imágenes/videos tiene un conmutador de tamaño S/M/L en la barra de herramientas (mediano = el tamaño anterior)
- **Contralink** — Las vistas de lista y tabla de imágenes/videos muestran qué notas enlazan a / incrustan cada archivo; haz clic en una ficha para abrir esa nota en el popover del editor en el sitio
- **Selector por página** — Secciones de imágenes/videos: elige 20 / 50 / 100 elementos por página
- **Popover de notas en móvil** — En móvil, hacer clic en enlaces de documentos y wikilinks ahora abre el popover del editor de notas en el sitio (igualando el escritorio; antes abría una nueva pestaña)
- **Secciones más altas + diseño de la barra de herramientas** — Las secciones de imágenes/videos son más altas por defecto; el conteo de archivos y el selector por página se sitúan en el extremo derecho de la barra de herramientas
- **Solapamiento corregido** — Las secciones de imágenes/videos ya no solapan el contenido inferior tras el aumento de altura

### 1.2.6
- **Paginación de medios** — La paginación de las secciones de imágenes/videos ahora coincide con la de la sección de base de datos: centrada, con múltiples números de página (primera/última + puntos suspensivos), en lugar de un solo anterior/siguiente
- **Selector de carpetas de medios** — El campo de carpeta del embudo de filtro ahora tiene un botón "Explorar" que abre una búsqueda difusa de carpetas (igual que la configuración de la sección de carpeta), en lugar de escribir la ruta manualmente

### 1.2.5
- **Filtro de etiquetas eliminado del embudo de la barra de herramientas** — El popup de filtro (embudo) de la sección de base de datos/carpeta ya no tiene filtro de etiquetas (era redundante); hace solo filtrado de fechas. El filtro de etiquetas de la sección de carpeta en su diálogo de configuración del engranaje no cambia

### 1.2.4
- **Embudo de filtro de medios** — Las secciones de imágenes/videos incorporan un embudo de filtro en la barra de herramientas: filtra por rango de fechas de creación/modificación y por ruta de carpeta (subcarpetas incluidas); los filtros activos se muestran como fichas eliminables
- **Columna Nombre de ancho fijo** — La columna Nombre de la vista de tabla de imágenes/videos ahora tiene un ancho fijo con puntos suspensivos, en lugar de crecer con nombres de archivo largos

### 1.2.3
- **Vistas de lista y tabla de medios** — Las secciones de imágenes/videos ahora admiten vistas de lista y tabla (además del muro de miniaturas en cuadrícula) mediante un conmutador en la barra de herramientas
- **Renombrar archivos de medios** — Doble clic en el nombre de un archivo en la vista de tabla para renombrarlo; `![[embeds]]` y `[[links]]` se actualizan automáticamente
- **Eliminar archivos de medios** — Un botón de basurero (con confirmación) en cada elemento de medios en cuadrícula/lista/tabla; los archivos eliminados van a la papelera de Obsidian (recuperables)
- **Estadísticas semana/mes del pomodoro corregidas** — Semana/mes ahora usan límites de calendario (lun→dom / 1→fin) en lugar de una ventana móvil de 7/30 días
- **Lightbox de medios corregido** — Las imágenes/videos ahora llenan y centran correctamente en el viewport

### 1.2.2
- **Filtro de etiquetas movido al embudo de la barra de herramientas** — El filtro de etiquetas de la sección de base de datos se movió del diálogo de configuración al popup del embudo (junto al filtro de fechas)
- **Búsqueda de valores reposicionada** — Configuración de base de datos: el cuadro de búsqueda de valores de propiedades ahora se sitúa a la derecha del desplegable de propiedades (misma fila) en lugar de debajo
- **Límite de etiquetas en tarjetas de carpeta** — Las tarjetas de cuadrícula de la sección de carpeta muestran como máximo 2 etiquetas (+insignia N) en una única línea sin ajuste, de modo que las tarjetas ya no crecen de altura con muchas etiquetas

### 1.2.1
- **Sección Images** — Un nuevo tipo de sección que escanea todo el vault en busca de imágenes (png/jpg/jpeg/gif/svg/webp/bmp) y las muestra como un muro de miniaturas; haz clic en cualquier miniatura para abrir un lightbox a pantalla completa (←/→ para navegar, Esc para cerrar)
- **Sección Videos** — La misma idea para videos (mp4/mov/mkv/avi/webm/m4v); la cuadrícula muestra el primer fotograma con una insignia de reproducción, haz clic para reproducir en línea en el lightbox
- Ambas secciones admiten búsqueda, ordenación y paginación

### 1.2.0
- **Editar acciones rápidas** — Pasa el cursor sobre una ficha personalizada de enlace/comando rápido para revelar un botón de edición (arriba a la izquierda); haz clic para renombrarla y elegir un nuevo icono. Solo escritorio
- **Eliminar sección** — Cada encabezado de sección ahora tiene un botón de basurero que elimina toda la sección tras un diálogo de confirmación
- **"Nuevo diario" corregido** — La acción rápida ahora pasa por el sistema de comandos de Obsidian, de modo que la nota diaria creada respeta la carpeta, el formato de fecha y la plantilla del plugin Daily notes del núcleo

### 1.1.9
- **Tarjetas de carpeta muestran etiquetas** — Las tarjetas de cuadrícula de la sección de carpeta ahora muestran las etiquetas del archivo (como fichas) en lugar de la ruta de la carpeta en la fila de metadatos
- **Cuadro de búsqueda de valores** — Configuración de base de datos: cada selector de valores de propiedades ahora tiene un cuadro de búsqueda para filtrar la lista de fichas
- **Kanban por defecto a etiquetas** — "Agrupar por" en la configuración de base de datos ahora por defecto es etiquetas (con una pista)

### 1.1.8
- **Filtro de etiquetas** — Las secciones de carpeta y base de datos incorporan una sección dedicada de filtro de Etiquetas (fichas activables; un archivo se muestra si tiene cualquiera de las etiquetas seleccionadas)

### 1.1.7
- **Sección Folder** — Un nuevo tipo de sección que lista cada documento bajo una carpeta del vault elegida (incluyendo subcarpetas). Elige una carpeta escribiendo la ruta o explorando con un selector difuso; la visualización reutiliza las vistas de cuadrícula/lista/tabla/kanban de la sección de base de datos con ordenación, búsqueda y paginación

### 1.1.6
- **Guardar todo en la nota diaria** — Un nuevo botón de guardado en cada tarjeta de todo escribe sus tareas (con estado de finalización y anidamiento preservados) al inicio de la nota diaria de hoy (ubicada mediante los ajustes del plugin Daily notes del núcleo)
- **Archivar tareas completadas** — Un nuevo botón de archivado en el encabezado de la sección todo mueve cada tarea marcada a un único archivo de archivo acumulativo como un registro con marca de tiempo
- **Ajuste de ruta del archivo de tareas** — Nuevo ajuste para la ruta del archivo de archivo (por defecto `归档/已完成.md`)

### 1.1.5
- **Vista previa al pasar el cursor para enlaces** — Mantén Ctrl/Cmd y pasa el cursor sobre cualquier enlace de documento o `[[wikilink]]` para ver un popover nativo de vista previa de página sin salir del dashboard. Funciona en las listas de documentos de tarjetas de proyecto/nota, wikilinks en línea en memos y todos, y la sección de base de datos (biblioteca)
- **Popover del editor de notas en el sitio** — Haz clic en un enlace para abrir un popup centrado que incrusta un editor Markdown completo de Obsidian (Live Preview, más un conmutador de lectura/código que recuerda tu última elección). Lee y edita la nota dentro del propio dashboard en lugar de abrir una pestaña nueva; un botón "Abrir en pestaña" está disponible cuando quieres el editor completo
- **Soporte en la sección de base de datos** — Los archivos de la biblioteca en vistas de cuadrícula, lista, tabla y kanban ahora admiten la vista previa al pasar el cursor y el popup de edición en el sitio, igualando la experiencia de la sección de proyecto
- **Móvil sin cambios** — En móvil, los enlaces conservan su comportamiento original de abrir en pestaña

### 1.1.4
- **Subtareas contraíbles** — Las tareas con subtareas ahora pueden contraerse; el estado contraído persiste entre recargas. Solo los elementos con hijos muestran una flecha de conmutación, de modo que los elementos hoja no llevan relleno izquierdo adicional y las listas se mantienen compactas
- **Enlaces de documentos anidados (subdocumentos) en tarjetas de proyecto** — Los enlaces de documentos en las tarjetas de proyecto ahora admiten anidamiento igual que las subtareas: arrastra uno sobre otro para anidarlo (zonas de soltado antes / después / anidar), y contrae los subdocumentos de un padre. Se guardan como listas anidadas Markdown con sangría para que los enlaces sigan siendo válidos en todas las vistas de Obsidian (sin roturas de bloque de código por la sangría)
- **Tareas anidadas (subtareas)** — Las tareas ahora admiten anidamiento multinivel, persistido como Markdown con sangría. Arrastra una tarea sobre otra para anidarla (zonas de soltado antes / después / anidar), reordena tareas o muévelas entre tarjetas. En móvil, mantén pulsado para arrastrar y desliza horizontalmente para anidar/desanidar. Marcar una tarea padre marca a todos sus hijos
- **Dos nuevos temas: Mono y Onyx** — Añadidos Mono (minimalismo puro de negro/blanco; renombrado desde entonces a Vermilion — minimalismo de tinta con acento de sello de cinabrio) y Onyx (negro puro con acento limón, idéntico en modo claro y oscuro). Eliminado el tema Spring (Prism)
- **Mejoras del widget de mapa de calor** — El mapa de calor de la barra lateral ahora puede resolver archivos de diario diario desde una carpeta configurable, admite un título de visualización personalizado y ofrece dos modos de rango: móvil (últimos N días) o periodo (mes / trimestre / año en curso)
- **Actualización automática del calendario de la barra lateral** — El calendario semanal de la barra lateral ahora actualiza automáticamente su resaltado de "hoy" y las fechas tras la medianoche, incluso cuando la vista del dashboard está fijada abierta (antes permanecía congelado en el día en que se abrió por primera vez)
- **Nomenclatura personalizada de acciones rápidas** — Al añadir una acción rápida de archivo o comando, ahora puedes fijar un nombre de visualización personalizado (y elegir un icono) en el paso de confirmación, en lugar de quedarte con el nombre por defecto
- **Corrección de estela de arrastre en móvil** — Mantener pulsada una tarjeta para arrastrar en móvil ya no deja una estela de texto permanente en pantalla cuando el toque es interrumpido por el sistema (gestos de borde, notificaciones, secuestro de scroll). Un manejador de touchcancel ahora limpia el fantasma del arrastre, los fantasmas varados se barren al re-renderizar, y las transiciones del clon fantasma y de la tarjeta arrastrada se deshabilitan para eliminar las estelas residuales
- **Guardar memo como nota** — Las tarjetas de memo pueden guardarse como notas independientes en tu vault mediante un nuevo botón "Guardar como nota", con una carpeta de guardado configurable (ajuste memoSavePath)

### 1.1.3
- **Rediseño de la barra de widgets móvil** — Los botones de pestañas superpuestos se sustituyeron por una tira contraíble bajo el banner. Toca la tira para revelar pestañas de marcador más anchas (Pomodoro, Reading, Lunar), luego toca una pestaña para expandir su panel de widget
- **Colores de pestañas adaptados al tema** — Los iconos de pestañas ahora transicionan de gris (inactivo) al color de texto primario del tema (activo), adaptándose tanto a temas claros como oscuros
- **Iconos de widgets actualizados** — Pomodoro usa icono de reloj de arena, Lunar usa icono de luna para una identidad visual más clara
- **Diálogos personalizados** — Los diálogos nativos del navegador se sustituyeron por modales personalizados al estilo de Obsidian
- **Renombrado de clases** — Se limpiaron las convenciones de nomenclatura de clases internas
- **Mejoras de estilo** — Varios pulidos visuales y correcciones de consistencia

### 1.1.2
- **Correcciones de la revisión del plugin de Obsidian** — Se atendió el feedback del proceso oficial de revisión de plugins de Obsidian
- **Licencia MIT** — La licencia cambió de ISC a MIT

### v1.1.1
- **Persistencia de la configuración de biblioteca** — Corregido un bug crítico por el que las configuraciones de la sección de biblioteca (filtros, modo de vista, ajustes de ordenación, tamaño de página) se perdían tras reiniciar Obsidian. El analizador YAML ahora maneja correctamente los objetos anidados en las definiciones de columnas
- **Persistencia de la posición de cuadrícula** — Corregido que los valores de posición de cuadrícula (gcol/grow) nunca se guardaban en el archivo del dashboard, haciendo que las posiciones de las tarjetas se restablecieran al recargar
- **Corrección de condición de carrera de escritura** — Corregida una condición de carrera en la que actualizaciones rápidas podían hacer que el vigilante de archivos sobrescribiera datos más recientes con contenido más antiguo

### v1.1.0
- **Widget de Reading Tracker** — Gestión completa de sesiones de lectura en la barra lateral: añade libros desde la búsqueda de Douban o introduciéndolos manualmente, inicia/pausa/detén el temporizador de lectura, y guarda sesiones con progreso de páginas
- **Tarjetas de libro** — Cada libro activo muestra imagen de portada, título, autor, barra de progreso de lectura y el tiempo de lectura de hoy. Las imágenes de portada admiten tanto URLs web como rutas locales del vault
- **Editar información del libro** — Pasa el cursor sobre una tarjeta de libro para revelar los botones de edición (lápiz) y eliminación (x). El modal de edición permite cambiar título, autor, páginas totales y URL/ruta de la imagen de portada
- **Estadísticas de lectura** — Página completa de estadísticas con tiempo total de lectura, lectura de hoy, número de libros, días de racha, lista de libros por rango de tiempo (semana/mes/año) y registros de sesiones recientes. Elimina registros individuales o historiales completos de libros
- **Selector de actividades del pomodoro** — El selector de actividades se movió a la posición del título del temporizador con un desplegable para categorizar sesiones de enfoque
- **Gráfico de dona del pomodoro** — Desglose visual de las sesiones de enfoque de hoy por actividad, mostrado como gráfico de dona en la vista de estadísticas

### v1.0.8
- **Widget de clima de la barra lateral** — Clima en tiempo real con temperatura actual, sensación térmica, humedad, velocidad del viento y pronóstico de 5 días (iconos diarios + máximas/mínimas). Impulsado por Open-Meteo, sin clave de API
- **Widget de mapa de calor de la barra lateral** — Mapa de calor de contribuciones estilo GitHub para registrar datos diarios de frontmatter (ánimo, sueño, peso, etc.)
- **Resumen del mapa de calor** — Estadísticas configurables bajo el mapa de calor: días de racha (⚡), tasa de finalización (✅), ambas, o apagado
- **Tira de calendario semanal** — Tira compacta de 7 días en la barra lateral resaltando hoy
- **Búsqueda de ciudades** — Autocompletado de geocodificación al configurar la ciudad del clima en los ajustes
- **Tarjetas de clima del dashboard** — Los widgets de tarjeta de clima del dashboard principal también muestran sensación térmica, humedad y viento
- **i18n** — Todos los ajustes de widgets de la barra lateral ahora admiten inglés y chino
- **5 nuevos temas** — Matcha (calidez de té verde), Lilac (púrpura suave), Sakura (rosa flor de cerezo), Eclipse (modo oscuro), Moonlight (azul plateado)

### v1.0.7
- **Recordatorios de tareas** — Fija recordatorios por tarea con una ventana emergente de calendario. Haz clic en el icono de campana de cualquier tarea para elegir fecha y hora
- **Selector de calendario** — Calendario mensual visual con navegación, selección de días y desplegables de hora/minuto (sin escribir fechas manualmente)
- **Indicador de vencimiento** — El icono de campana de las tareas vencidas se vuelve rojo con una animación de pulso
- **Notificaciones de Obsidian** — Un verificador periódico de 60 segundos dispara una Notice de Obsidian cuando una tarea vence
- **Almacenamiento markdown en línea** — Los recordatorios se guardan como `⏰ YYYY-MM-DD HH:MM` en el texto de la tarea, completamente legibles y editables en el archivo markdown
- **Tema Island** — Nuevo tema pastel inspirado en Animal Crossing con secciones verde bosque y acentos azul océano
- **i18n** — La interfaz de recordatorios admite inglés y chino
- **Tarjetas de sección redimensionables** — Arrastra para redimensionar cualquier tarjeta dentro de una sección, con restricciones de ancho mín/máx y dimensiones persistentes
- **Barra lateral contraíble** — La barra lateral izquierda ahora es redimensionable; haz clic en el botón de fijar para anclarla en su sitio
- **6 nuevos temas** — Tundra (aurora verde salvia), Blossom (cristal rosa, secciones transparentes), Haze (neblina azul ahumada, transparencia de cristal), Ember (humo cálido de fogata), Dusk (niebla púrpura crepuscular), Jade (niebla verde bambú)
- **Secciones transparentes** — Tundra, Blossom, Haze, Ember, Dusk y Jade presentan secciones transparentes sin bordes con tarjetas flotantes
- **Superposición del banner eliminada** — Las imágenes del banner ya no se cubren con un filtro oscuro de superposición
- **Rotación del banner más rápida** — Las citas rotan cada 1 hora, las imágenes cada 30 minutos

### v1.0.6
- **Banner multi-cita** — Almacena múltiples citas en el banner, cada una con su propio autor. Añade, edita y elimina citas en el modal de edición
- **Rotación de imágenes del banner** — Añade múltiples imágenes de fondo que rotan cada 2 horas con una transición de fundido suave
- **Autorotación de citas** — Las citas rotan cada 2 horas (desfasadas 1 hora respecto a la rotación de imágenes para que nunca cambien a la vez)
- **Renombrar secciones con doble clic** — Doble clic en cualquier título de sección para renombrarlo en línea (Enter para guardar, Escape para cancelar)
- **Secciones contraíbles** — Haz clic en el indicador triangular de los encabezados de sección para contraer/expandir secciones. El estado contraído persiste entre sesiones
- **Drag & drop entre tarjetas** — Arrastra enlaces de documentos entre tarjetas de proyecto/nota, y arrastra elementos de tarea entre tarjetas de todo
- **Corrección de reordenamiento de tarjetas** — Corregido el posicionamiento del arrastrar y soltar de tarjetas en todas las secciones (Todo, Projects, Notes). Las tarjetas ahora aterrizan exactamente donde las sueltas en lugar de moverse siempre a la primera posición
- **Interacción con tarjetas vacías** — Las tarjetas con todos sus elementos eliminados ahora pueden recibir nuevos elementos mediante arrastrar y soltar o el campo de añadir
- **Mejoras móviles** — Botón del selector de color de memo oculto en móvil, el cajón móvil usa fondo sólido en todos los temas, lista de acciones rápidas más alta

### v1.0.5
- **Colores de conmutación distintos** — Cada tipo de sección (Memo, Todo, Projects, Notes) tiene su propio color de indicador triangular
- **Dimensionado de botones del modal del banner** — Los botones "Añadir cita" y "Añadir imagen" del modal de edición del banner ahora usan ancho fit-content en lugar de estirarse a todo el ancho
- **Ancho por defecto de tarjetas de Projects** — Corregido que las nuevas tarjetas de proyecto se estiraban por toda la sección; las tarjetas ahora tienen un ancho por defecto adecuado (280 px)
- **Robustez del tipo de sección** — Defensa de tres capas para preservar el tipo de sección: campo de frontmatter `type:`, heurísticas basadas en el nombre, y análisis de distribución de tipos de tarjetas. Los tipos de sección sobreviven a ediciones manuales del archivo, renombrados de encabezados e intercambios de posición
- **Persistencia del tipo de tarjeta de proyecto** — `type: project` ahora se escribe en el archivo y se preserva entre ciclos de guardado/recarga, evitando que las tarjetas reviertan a un tipo genérico
- **Corrección de la plantilla por defecto** — Las secciones de Projects y Library ahora incluyen `sectionType` en la plantilla por defecto y en las definiciones de columnas

### v1.0.4
- **Quick Actions** — Quick Links se actualizó a Quick Actions, admitiendo tanto enlaces a archivos como atajos de comandos de Obsidian
- **Modal de añadir acción** — Dos pestañas (Archivo / Comando) para añadir acciones personalizadas, con presets integrados para Nuevo diario y Nueva nota
- **4 tipos de secciones** — Memo, Todo, Projects y Notes, cada uno con su propio diseño y comportamiento
- **Soporte de documentos multiformato** — Gestiona Markdown, PDF, imágenes (PNG, JPG, GIF, SVG, WebP), audio (MP3, M4A) y video (MP4, MOV) en tarjetas de proyecto
- **Enlaces bidireccionales** — Las tarjetas de Memo y Todo renderizan `[[wikilinks]]` como enlaces clicables con alternativa por nombre base
- **Ajuste de ruta del diario** — Configura dónde se guardan las nuevas entradas de diario
- **Pulido de interfaz** — Barras de desplazamiento verticales ocultas en escritorio, barra de desplazamiento horizontal con color del tema, optimización del diseño de la sección de notas
- **Corrección de bugs** — Corregidos los clics de wikilinks en tarjetas de memo, la condición de carrera al renombrar enlaces rápidos, y la limpieza del listener de renombrado al descargar el plugin

### v1.0.3
- **Soporte de wikilinks** — Las tarjetas de Memo y Todo ahora renderizan `[[wikilinks]]` como enlaces clicables
- **Selector de tipo de sección** — Elige el tipo de sección al crear nuevas secciones
- **Cajón de barra lateral móvil** — Animación de deslizamiento para la navegación móvil
- **UX de creación de secciones** — Botón de confirmación para la creación de secciones en móvil, atajo de comando 'Add new section'
- **Corrección de bugs** — Arrastre de tarjetas restringido al área de encabezado/portada, botón de edición del banner en móvil, alineación del cajón

### v1.0.2
- **Gestión de secciones** — Eliminación manual de secciones, selector de tipo de sección
- **Mejoras móviles** — Mejor desplazamiento de tarjetas y diseño móvil
- **Corrección de bugs** — Respeto del orden de las secciones del cuerpo, prevención del reinicio de formularios

## Compatibilidad

- Obsidian v0.15.0+
- Escritorio y móvil
- Todos los temas funcionan tanto en modo claro como oscuro de Obsidian

## Licencia

0BSD

### Inicio de sesión con cuenta de NetEase y privacidad

En escritorio, abre Ajustes → Apex Dashboard → Widgets → Music y selecciona Iniciar sesión por teléfono / NetEase. Completa el inicio de sesión por teléfono en el sitio oficial si se ofrece; NetEase puede requerir inicio de sesión por QR. No hay ningún endpoint de SMS aparte en este plugin. La membresía, las compras y los derechos regionales los verifica NetEase; los clips de prueba no se reproducen como canciones completas.

Las credenciales se envían directamente a NetEase. El plugin usa la sesión local para las solicitudes de cuenta y URLs de reproducción. Las cookies permanecen en una sesión Electron local de Obsidian aislada, fuera de data.json y de la sincronización del vault. Cerrar sesión detiene la reproducción y borra esa sesión local. Inicia sesión de nuevo si caduca. No se usa ningún proxy de terceros.

### Mover tarjetas entre secciones

Arrastra el encabezado de una tarjeta entre las secciones Todo, Memo y Sticky. Las notas con o sin portadas también pueden moverse a estas secciones. Los destinos de Memo muestran el texto original, tareas y enlaces como un memo. Los destinos de Todo conservan las tareas existentes y convierten las demás líneas de texto no vacías y los enlaces de notas en elementos sin marcar. Los destinos de Sticky preservan la apariencia original de la tarjeta, incluido si una nota tiene portada. Los cambios persisten entre recargas. Mover una tarjeta del tablero no mueve ni elimina los archivos del vault enlazados.
