const express = require('express');
const path = require('path');
const XLSX = require('xlsx');
const { MongoClient } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin2026';
const MONGODB_URI = process.env.MONGODB_URI;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let db;

async function conectarDB() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  db = client.db('empanadas_pastoral');
  console.log('MongoDB conectado');
}

const col = () => db.collection('vendedores');
const colVentas = () => db.collection('ventas');

// ─── AUTH VENDEDOR ───────────────────────────────────────────────────────────

// Lista pública de vendedores (para el desplegable del login)
app.get('/api/vendedores-lista', async (req, res) => {
  const vendedores = await col().find({}, { projection: { usuario: 1, nombre: 1, _id: 0 } }).sort({ nombre: 1 }).toArray();
  res.json(vendedores);
});

// Login vendedor
app.post('/api/login', async (req, res) => {
  const { usuario } = req.body;
  if (!usuario) return res.status(400).json({ error: 'Falta usuario' });
  const vendedor = await col().findOne({ usuario: usuario.trim().toLowerCase() });
  if (!vendedor) return res.status(401).json({ error: 'Usuario no encontrado' });
  res.json({ ok: true, nombre: vendedor.nombre });
});

// ─── VENTAS VENDEDOR ─────────────────────────────────────────────────────────

// Obtener ventas del vendedor
app.get('/api/ventas', async (req, res) => {
  const { usuario } = req.query;
  if (!usuario) return res.status(400).json({ error: 'Falta usuario' });
  const vendedor = await col().findOne({ usuario: usuario.trim().toLowerCase() });
  if (!vendedor) return res.status(401).json({ error: 'No autorizado' });
  const ventas = await colVentas().find({ usuario: usuario.trim().toLowerCase() }).toArray();
  res.json(ventas);
});

// Agregar o editar comprador/venta
app.post('/api/ventas', async (req, res) => {
  const { usuario, comprador } = req.body;
  // comprador: { id, nombre, tickets: [{numero, docenas, mediaDocenas}] }
  if (!usuario || !comprador) return res.status(400).json({ error: 'Datos incompletos' });
  const vendedor = await col().findOne({ usuario: usuario.trim().toLowerCase() });
  if (!vendedor) return res.status(401).json({ error: 'No autorizado' });

  if (comprador.id) {
    // Editar existente
    await colVentas().updateOne(
      { usuario: usuario.trim().toLowerCase(), _id: new (require('mongodb').ObjectId)(comprador.id) },
      { $set: { nombre: comprador.nombre, tickets: comprador.tickets, updatedAt: new Date().toISOString() } }
    );
  } else {
    // Nuevo comprador
    await colVentas().insertOne({
      usuario: usuario.trim().toLowerCase(),
      nombre: comprador.nombre,
      tickets: comprador.tickets,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }
  res.json({ ok: true });
});

// Eliminar comprador
app.delete('/api/ventas', async (req, res) => {
  const { usuario, id } = req.body;
  if (!usuario || !id) return res.status(400).json({ error: 'Datos incompletos' });
  const vendedor = await col().findOne({ usuario: usuario.trim().toLowerCase() });
  if (!vendedor) return res.status(401).json({ error: 'No autorizado' });
  await colVentas().deleteOne({ usuario: usuario.trim().toLowerCase(), _id: new (require('mongodb').ObjectId)(id) });
  res.json({ ok: true });
});

// ─── ADMIN ───────────────────────────────────────────────────────────────────

const PRECIO_DOCENA = 22000;
const PRECIO_MEDIA = 13000;
const GANANCIA_DOCENA = 4000;
const GANANCIA_MEDIA = 3000;
const COSTO_DOCENA = PRECIO_DOCENA - GANANCIA_DOCENA;
const COSTO_MEDIA = PRECIO_MEDIA - GANANCIA_MEDIA;

function auth(req, res) {
  const pw = req.query.password || req.body?.password;
  if (pw !== ADMIN_PASSWORD) { res.status(401).json({ error: 'No autorizado' }); return false; }
  return true;
}

// Listar vendedores
app.get('/api/admin/vendedores', async (req, res) => {
  if (!auth(req, res)) return;
  const vendedores = await col().find({}).toArray();
  res.json(vendedores);
});

// Crear vendedor
app.post('/api/admin/vendedores', async (req, res) => {
  if (!auth(req, res)) return;
  const { usuario, nombre } = req.body;
  if (!usuario || !nombre) return res.status(400).json({ error: 'Faltan datos' });
  const existe = await col().findOne({ usuario: usuario.trim().toLowerCase() });
  if (existe) return res.status(409).json({ error: 'Usuario ya existe' });
  await col().insertOne({ usuario: usuario.trim().toLowerCase(), nombre: nombre.trim(), creadoEn: new Date().toISOString() });
  res.json({ ok: true });
});

// Eliminar vendedor y sus ventas
app.delete('/api/admin/vendedores', async (req, res) => {
  if (!auth(req, res)) return;
  const { usuario } = req.body;
  if (!usuario) return res.status(400).json({ error: 'Falta usuario' });
  await col().deleteOne({ usuario: usuario.trim().toLowerCase() });
  await colVentas().deleteMany({ usuario: usuario.trim().toLowerCase() });
  res.json({ ok: true });
});

// Ver todas las ventas (admin)
app.get('/api/admin/ventas', async (req, res) => {
  if (!auth(req, res)) return;
  const vendedores = await col().find({}).toArray();
  const ventas = await colVentas().find({}).toArray();
  const resultado = vendedores.map(v => {
    const mis = ventas.filter(x => x.usuario === v.usuario);
    const totDocenas = mis.reduce((s, c) => s + c.tickets.filter(t => t.tipo === 'docena' || (!t.tipo && t.docenas > 0)).length, 0);
    const totMedias = mis.reduce((s, c) => s + c.tickets.filter(t => t.tipo === 'mediaDocena' || (t.mediaDocenas > 0)).length, 0);
    return {
      usuario: v.usuario,
      nombre: v.nombre,
      compradores: mis,
      totalDocenas: totDocenas,
      totalMedias: totMedias,
      totalRecaudado: totDocenas * PRECIO_DOCENA + totMedias * PRECIO_MEDIA,
      totalGanancia: totDocenas * GANANCIA_DOCENA + totMedias * GANANCIA_MEDIA,
      totalProveedor: totDocenas * COSTO_DOCENA + totMedias * COSTO_MEDIA,
    };
  });
  res.json(resultado);
});

// Exportar Excel (admin)
app.get('/api/admin/exportar', async (req, res) => {
  if (!auth(req, res)) return;
  const vendedores = await col().find({}).toArray();
  const ventas = await colVentas().find({}).toArray();

  const wb = XLSX.utils.book_new();

  // Hoja 1: Detalle completo
  const rows1 = [['Vendedor','Comprador','Ticket','Docenas','Medias Docenas','Total $','Ganancia $','Pago Proveedor $']];
  let totalDocGlobal = 0, totalMedGlobal = 0, totalRecGlobal = 0, totalGanGlobal = 0, totalProvGlobal = 0;

  vendedores.forEach(v => {
    const mis = ventas.filter(x => x.usuario === v.usuario);
    mis.forEach(c => {
      c.tickets.forEach(t => {
        const doc = (t.tipo === 'docena' || (!t.tipo && t.docenas > 0)) ? 1 : 0;
        const med = (t.tipo === 'mediaDocena' || t.mediaDocenas > 0) ? 1 : 0;
        const total = doc * PRECIO_DOCENA + med * PRECIO_MEDIA;
        const gan = doc * GANANCIA_DOCENA + med * GANANCIA_MEDIA;
        const prov = doc * COSTO_DOCENA + med * COSTO_MEDIA;
        totalDocGlobal += doc; totalMedGlobal += med;
        totalRecGlobal += total; totalGanGlobal += gan; totalProvGlobal += prov;
        rows1.push([v.nombre, c.nombre, t.numero, doc, med, total, gan, prov]);
      });
    });
  });
  rows1.push(['TOTAL','','','',totalDocGlobal+totalMedGlobal,totalRecGlobal,totalGanGlobal,totalProvGlobal]);

  const ws1 = XLSX.utils.aoa_to_sheet(rows1);
  ws1['!cols'] = [{wch:20},{wch:20},{wch:10},{wch:10},{wch:16},{wch:14},{wch:14},{wch:18}];
  XLSX.utils.book_append_sheet(wb, ws1, 'Detalle');

  // Hoja 2: Resumen por vendedor
  const rows2 = [['Vendedor','Docenas','Medias Docenas','Total Recaudado $','Ganancia Pastoral $','Pago Proveedor $']];
  vendedores.forEach(v => {
    const mis = ventas.filter(x => x.usuario === v.usuario);
    const doc = mis.reduce((s,c)=>s+c.tickets.filter(t=>t.tipo==='docena'||(!t.tipo&&t.docenas>0)).length,0);
    const med = mis.reduce((s,c)=>s+c.tickets.filter(t=>t.tipo==='mediaDocena'||(t.mediaDocenas>0)).length,0);
    rows2.push([v.nombre, doc, med, doc*PRECIO_DOCENA+med*PRECIO_MEDIA, doc*GANANCIA_DOCENA+med*GANANCIA_MEDIA, doc*COSTO_DOCENA+med*COSTO_MEDIA]);
  });
  const ws2 = XLSX.utils.aoa_to_sheet(rows2);
  ws2['!cols'] = [{wch:20},{wch:12},{wch:16},{wch:20},{wch:22},{wch:20}];
  XLSX.utils.book_append_sheet(wb, ws2, 'Por Vendedor');

  // Hoja 3: Tickets numerados
  const rows3 = [['N° Ticket','Vendedor','Comprador','Docenas','Medias Docenas','Total $']];
  const todosTickets = [];
  vendedores.forEach(v => {
    const mis = ventas.filter(x => x.usuario === v.usuario);
    mis.forEach(c => {
      c.tickets.forEach(t => {
        todosTickets.push({ numero: t.numero, vendedor: v.nombre, comprador: c.nombre, doc: t.docenas||0, med: t.mediaDocenas||0 });
      });
    });
  });
  todosTickets.sort((a,b)=> String(a.numero).localeCompare(String(b.numero), undefined, {numeric:true}));
  todosTickets.forEach(t => {
    rows3.push([t.numero, t.vendedor, t.comprador, t.doc, t.med, t.doc*PRECIO_DOCENA+t.med*PRECIO_MEDIA]);
  });
  const ws3 = XLSX.utils.aoa_to_sheet(rows3);
  ws3['!cols'] = [{wch:12},{wch:20},{wch:20},{wch:10},{wch:16},{wch:14}];
  XLSX.utils.book_append_sheet(wb, ws3, 'Por Ticket');

  const buffer = XLSX.write(wb, { type:'buffer', bookType:'xlsx' });
  const fecha = new Date().toLocaleDateString('es-AR').replace(/\//g,'-');
  res.setHeader('Content-Disposition',`attachment; filename="empanadas_pastoral_${fecha}.xlsx"`);
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

// Editar venta desde admin
app.post('/api/admin/editar-venta', async (req, res) => {
  if (!auth(req, res)) return;
  const { id, nombre, tickets } = req.body;
  if (!id) return res.status(400).json({ error: 'Falta id' });
  await colVentas().updateOne(
    { _id: new (require('mongodb').ObjectId)(id) },
    { $set: { nombre, tickets, updatedAt: new Date().toISOString() } }
  );
  res.json({ ok: true });
});

// Eliminar venta desde admin
app.delete('/api/admin/venta', async (req, res) => {
  if (!auth(req, res)) return;
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'Falta id' });
  await colVentas().deleteOne({ _id: new (require('mongodb').ObjectId)(id) });
  res.json({ ok: true });
});

conectarDB().then(() => {
  app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
}).catch(err => {
  console.error('Error MongoDB:', err);
  process.exit(1);
});

