# Selectores de valores compartidos

La selección de club, temporada, equipo, categoría, grupo y otros valores utiliza
`SelectField`, sin librerías nuevas. Conserva el campo cerrado anterior; solamente
la lista abierta recibe presentación propia. No cambia los contratos ni las reglas
de negocio. La aprobación visual del campo cerrado se recibió durante la revisión
del 29/10/2026.

## Presentación

Campo de borde redondeado, fondo `surface`, placeholder `muted`, flecha a la derecha
y altura mínima de 48 px. Las opciones emplean una lista de altura limitada con
scroll, se abren arriba o abajo según el espacio y se ajustan al viewport. El cobre
marca la opción recorrida y la seleccionada; una marca adicional distingue la
selección confirmada. Se conservan las dos paletas existentes.

Las clases básicas del recuadro, posición y opciones se declaran también con las
utilidades vigentes en el componente. El control no debe perder el borde, ancho o
flecha si un servidor de desarrollo todavía conserva una versión anterior de los
estilos globales. `globals.css` reúne los detalles de presentación compartidos.

## Integración

```tsx
<label htmlFor="club">Club *</label>
<SelectField id="club" name="clubId" required value={clubId}
  onValueChange={changeClub}
  options={clubs.map(club => ({ value: club.id, label: club.name }))} />
```

Las páginas de servidor pueden pasar `defaultValue` y opciones serializables sin
convertir toda la página en cliente. El campo oculto conserva el valor real para
`FormData` y formularios GET. Los textos de búsqueda nunca se envían como ID.
Filtrar no confirma una opción; Escape o salir del campo recupera la etiqueta de
la selección previa. Las búsquedas ignoran mayúsculas y acentos, e incluyen la
descripción opcional (por ejemplo, una referencia de club).

Las opciones retiradas dejan de enviarse, y los controles deshabilitados siguen
excluidos de `FormData`, también dentro de un `fieldset`. Reset recupera el valor
inicial del selector no controlado. Los controles dependientes siguen utilizando
sus controladores existentes para limpiar temporada, equipo, categoría y grupo.

El campo oculto tiene `data-select-input-id`; `focusFormControl(form, name)` dirige
el foco al control visible. Utilizarlo en validaciones y al iniciar otra captura.

## Accesibilidad y comportamiento

Implementa un combobox con lista de opciones siguiendo el
[patrón de WAI-ARIA](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/): nombre
asociado, expansión, opción activa y selección confirmada, flechas/Enter/Escape/Tab
y conservación del foco en el campo. No crea opciones nuevas a partir de texto.
Home/End recorren la lista cuando no se está editando una búsqueda.

El popup se coloca en el diálogo contenedor cuando existe; fuera de diálogos se
monta en `body` para evitar recortes por tarjetas. La búsqueda es opcional mediante
`searchable={false}`; el selector compacto de tema usa esa variante.

## Alcance migrado

- Formulario y consultas de inscripciones; sus escenarios de demostración.
- Alta de cuentas: persona, liga y club.
- Captura y revisión de afiliaciones.
- Selección del contexto del dashboard.
- Tema de color sin sesión. El menú de cuenta conserva su interruptor existente.

## Verificación

Las suites de formularios, afiliaciones, dashboard y tema comprueban que se
conserven las reglas existentes. `test:team-registration-browser` monta React DOM
real y Chrome headless con datos y respuestas de negocio sintéticos; comprueba
búsqueda, códigos enviados, Escape, teclado, scroll, opciones retiradas, reset,
validación, `fieldset` deshabilitado, foco de errores y separación entre cuentas.
No equivale a probar escrituras con el backend ni a la regresión de PDGLD-116.

### Resultado de la revisión

Verificado el 29/10/2026: typecheck y lint correctos; suites de cuentas (12),
afiliaciones (29), dashboard (6), tema (7) y registro/consulta/actividad (73)
correctas. La prueba de Chrome headless también pasó con selectores buscables y
sin búsqueda, datos sintéticos y los recorridos de foco/cambio de cuenta existentes.

Revisión visual sobre `/dev/team-registration`: recuadro y flecha conservados,
opción confirmada con cobre y check, ambos temas, escritorio y viewport de 390 px
sin desbordamiento horizontal. Esa página utiliza datos de demostración y no
registra inscripciones. No se revisó visualmente cada combinación de permisos de
todas las pantallas; sus servicios, contratos y controles de autorización no cambian.
