function gerarLinkGoogleCalendar(titulo, descricao, local, inicio, fim) {
  const formatarData = (date) => date.toISOString().replace(/-|:|\.\d+/g, "");
  const start = formatarData(new Date(inicio));
  const end = formatarData(new Date(fim));

  return (
    "https://calendar.google.com/calendar/r/eventedit?" +
    `text=${encodeURIComponent(titulo)}` +
    `&dates=${start}/${end}` +
    `&details=${encodeURIComponent(descricao)}` +
    `&location=${encodeURIComponent(local)}`
  );
}

function gerarICS(titulo, descricao, local, inicio, fim) {
  const formatarDataICS = (date) =>
    date.toISOString().replace(/-|:|\.\d+/g, "");

  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//SeuProjeto//Reserva de Chromebooks//PT
BEGIN:VEVENT
UID:${Date.now()}@seudominio.com
DTSTAMP:${formatarDataICS(new Date())}
DTSTART:${formatarDataICS(new Date(inicio))}
DTEND:${formatarDataICS(new Date(fim))}
SUMMARY:${titulo}
DESCRIPTION:${descricao}
LOCATION:${local}
END:VEVENT
END:VCALENDAR`;
}

module.exports = {
  gerarLinkGoogleCalendar,
  gerarICS,
};
