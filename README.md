# Mi Hucha

App Android para llevar tus nóminas, ahorros, gastos y viajes a partir de los PDF de tu banco. Todo se guarda en el móvil: no hay servidores ni cuentas.

Creada por [alebarzal](https://github.com/alebarzal).

## Qué hace

- **Importa PDF**: extractos de movimientos del banco y nóminas. También desde el menú "Compartir" de Android.
- **Inicio**: saldo, cobrado y gastado desde la última nómina, y cuánto puedes gastar al día para cumplir tu objetivo de ahorro.
- **Gastos**: desglose por categoría (gasolina, supermercado, ocio…) con gráfico, comparación con el periodo anterior y detalle por comercio.
- **Movimientos**: buscador, filtros y categorías automáticas que aprenden de tus cambios.
- **Topes de gasto** por categoría entre nómina y nómina.
- **Nóminas**: desglose de bruto, Seguridad Social e IRPF, neto por hora y previsión orientativa de la renta.
- **Ahorro**: objetivos con aportaciones y lo que ahorras en cada periodo.
- **Viajes**: indicas dónde vives y la app separa los pagos de tu zona de los de fuera, propone viajes y muestra el gasto por lugar.
- **Avisos del banco**: lee las notificaciones de la app del banco y de Google Wallet o Samsung Wallet (con el nombre del comercio) y apunta cada pago al momento como pendiente, hasta que llega el extracto.
- **Ubicación de los pagos** (opcional): guarda dónde estabas al llegar cada aviso, con calle, ciudad y enlace al mapa. Solo se captura en el instante del aviso y se guarda en el móvil.
- **Apunte rápido** para el efectivo, **recordatorios** para importar y **bloqueo** con PIN y huella.
- **Gesto atrás** que cierra menús y vuelve a Inicio, con confirmación opcional antes de salir.
- **Copia de seguridad** exportable a un archivo.

## Tecnología

Web (Vite y JavaScript sin framework) empaquetada con [Capacitor](https://capacitorjs.com) para Android. Los PDF se leen con [pdf.js](https://mozilla.github.io/pdf.js/). La parte nativa (compartir PDF, huella y lectura de notificaciones) está en `android/app/src/main/java/com/mihucha/app`.

## Desarrollo

Requisitos: Node 20 o superior, JDK 21 y el SDK de Android.

```bash
npm install
npm run dev
```

Para generar el APK:

```bash
npm run android
cd android
./gradlew assembleDebug
```

El APK queda en `android/app/build/outputs/apk/debug/`.

## Formatos admitidos

Los lectores están en `src/parser.js` (PDF) y `src/noti.js` (notificaciones). Están ajustados a los extractos y avisos del Banco Santander y a las nóminas de Adecco; otros bancos o empresas pueden necesitar adaptar esos archivos.

## Aviso

La previsión de la renta es orientativa y no sustituye al simulador de la Agencia Tributaria.
