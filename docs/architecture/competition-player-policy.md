# PDGLD-38 — Reglas que consumirá el registro de jugadores

Fuente: respuestas comunicadas por Sergio de la consulta al profesor del
30/10/2026, 10:00, y aclaraciones posteriores en la conversación. Este documento
registra requisitos; no acredita que estén implementados ni habilita jugadores.
No se adjunta audio por indicación de Sergio.

## Configuración y edad

Cada liga configura sus reglas por temporada/categoría. Morelia sirve como
configuración inicial propuesta, sin imponerla a todas las ligas.

La edad de referencia se calcula por año: año de referencia de la temporada menos
año de nacimiento. No depende del día del registro ni del cumpleaños. Por ejemplo,
en 2026, una persona nacida en 2010 tiene edad de referencia 16.

| Categoría | Rango ordinario de referencia | Excepción |
| --- | --- | --- |
| Sub-8 hasta Sub-14 | Máximo de la Sub y un año menos | Sin extensión por carta |
| Sub-15 y superiores | Máximo de la Sub y hasta dos años menos | Un año adicional por debajo, con responsiva y aprobación administrativa |
| Libre | Desde 18, sin máximo por edad | No impide participar también en una Sub compatible |
| Veteranos inicial | Desde 35, por año de referencia | Otras divisiones mínimas se configuran |

Ejemplo Sub-16 en 2026: nacidos en 2010, 2011 y 2012 cumplen el rango ordinario;
nacidos en 2013 requieren carta y aprobación administrativa; nacidos en 2009
superan el máximo. Presentar la carta no concede elegibilidad. El delegado la
respalda al presentarla y la administración decide si acepta o rechaza. No se
admite una excepción que permita superar el máximo de una Sub.

El catálogo inicial comienza en Sub-8. Cumplir una categoría no prohíbe jugar en
otra si también cumple sus requisitos. No agregar una prohibición permanente de
bajar de Sub por haber participado antes en otra.

## Documentos, ventanas y participación

- Foto, CURP y credencial; para menores, credencial escolar; para veteranos, INE.
  La responsiva se exige en la excepción descrita. No se presupone una API del INE.
- Ventana semanal de lunes a miércoles; cerrada desde el jueves. Al implementar,
  vincularla con la zona horaria configurada de la liga y no con la del servidor.
- Se permite jugar una mitad en una categoría y otra mitad en otro partido si
  se cumplen los requisitos. No inventar una prohibición general por esa situación.
- Ascenso de jugador por fuerzas: Tercera → Segunda → Primera, sin salto directo.
  Es una regla distinta del ascenso de equipos.
- Plantilla sin máximo general; jugadores en cancha y máximo de convocados son
  parámetros separados, configurables según categoría/competencia.

## Contrato implementado en PDGLD-94

PATCH `/api/competitions/seasons/{id}/categories/{participationId}/player-policy`
recibe expectedSeasonVersion, reason y policy. Requiere competitions:UPDATE en
la temporada, mismo origen, PLANNED sin inicio y versión vigente. Guarda año de
referencia, mínimo/máximo ordinarios, mínimo excepcional opcional, documentos,
días ISO (lunes=1), zona horaria IANA, jugadores en cancha y máximos opcionales de
convocatoria/plantilla. Un máximo null significa sin límite configurado, no cero.
La respuesta contiene id, seasonVersion y eligibilityPending=false. Una edición
con jugadores registrados en la categoría rechaza PLAYER_POLICY_IN_USE.

GET de categorías incluye playerPolicy. El contrato interno readPlayerPolicy
recibe la transacción, temporada y participación; rechaza configuración ausente,
inválida o pendiente. Su consumidor debe autorizar su operación en la misma
transacción. evaluatePlayerAge devuelve ORDINARY_RANGE, OUTSIDE_RANGE o
REQUIRES_ADMIN_APPROVAL; nunca considera aprobada una responsiva. La función
isPlayerRegistrationDay calcula el día en la zona de la liga.

El registro debe consultar esa configuración vigente en servidor y las
aprobaciones del expediente. No
derivar reglas del nombre visible de la categoría ni confiar en edades o permisos
calculados por el navegador.

La migración aditiva 20261030110000 agrega player_policy en season_categories,
sin configurar ni habilitar filas legadas. Las escrituras actualizan también
minimum_age/maximum_age y age_cutoff_date al 31 de diciembre del año de referencia,
conservando su compatibilidad. La política y el incremento de versión se auditan
atómicamente; los cambios previos permanecen en auditoría.

Consumirlo al registrar y revisar expedientes se coordina con las tareas de
jugadores. Esta entrega no crea esas pantallas ni suplanta su aprobación. El
esquema legado contiene unique_player_per_season: su compatibilidad con participar
en varias categorías debe resolverse en la tarea de jugadores, sin quitar aquí
esa protección. Ascensos, participación por mitades y documentos reales siguen
siendo responsabilidad de sus módulos; no los declara implementados este contrato.
