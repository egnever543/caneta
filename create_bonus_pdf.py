from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
from reportlab.lib.enums import TA_CENTER, TA_LEFT

W, H = A4

TEAL   = colors.HexColor('#1E4A4A')
TEAL_L = colors.HexColor('#2D6E6E')
GOLD   = colors.HexColor('#CE9B4C')
CREAM  = colors.HexColor('#FAF6EF')
LIGHT  = colors.HexColor('#EFE7D8')
MUTED  = colors.HexColor('#8A8070')
WHITE  = colors.white

doc = SimpleDocTemplate(
    'Plano_30_Dias_Pos_Tratamento.pdf',
    pagesize=A4,
    leftMargin=18*mm, rightMargin=18*mm,
    topMargin=14*mm, bottomMargin=14*mm
)

def bg(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(CREAM)
    canvas.rect(0, 0, W, H, fill=1, stroke=0)
    canvas.setFillColor(TEAL)
    canvas.rect(0, H - 38*mm, W, 38*mm, fill=1, stroke=0)
    canvas.restoreState()

styles = getSampleStyleSheet()

S = lambda name, **kw: ParagraphStyle(name, **kw)

cover_title = S('ct', fontName='Helvetica-Bold', fontSize=22, textColor=WHITE,
                alignment=TA_CENTER, leading=28)
cover_sub   = S('cs', fontName='Helvetica', fontSize=11, textColor=LIGHT,
                alignment=TA_CENTER, leading=16)
cover_tag   = S('ctag', fontName='Helvetica-Bold', fontSize=9, textColor=GOLD,
                alignment=TA_CENTER, spaceAfter=4)

section_h   = S('sh', fontName='Helvetica-Bold', fontSize=13, textColor=TEAL,
                spaceBefore=10, spaceAfter=4, leading=17)
week_title  = S('wt', fontName='Helvetica-Bold', fontSize=11, textColor=WHITE,
                alignment=TA_CENTER, leading=15)
week_sub    = S('ws', fontName='Helvetica', fontSize=9, textColor=LIGHT,
                alignment=TA_CENTER, spaceAfter=2)
body        = S('bd', fontName='Helvetica', fontSize=9.5, textColor=TEAL,
                leading=14, spaceAfter=3)
bullet_s    = S('bl', fontName='Helvetica', fontSize=9.5, textColor=TEAL,
                leading=14, leftIndent=12, spaceAfter=2,
                bulletIndent=0, bulletFontName='Helvetica', bulletFontSize=9.5)
label       = S('lb', fontName='Helvetica-Bold', fontSize=9, textColor=MUTED,
                spaceAfter=1)
tip_s       = S('tp', fontName='Helvetica-Oblique', fontSize=9, textColor=MUTED,
                leading=13, leftIndent=10, spaceAfter=6)
footer_s    = S('ft', fontName='Helvetica', fontSize=7.5, textColor=MUTED,
                alignment=TA_CENTER)

def week_header(num, title, focus):
    data = [[Paragraph(f'SEMANA {num}', week_title),
             Paragraph(title, week_title)]]
    t = Table(data, colWidths=[30*mm, 133*mm])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), TEAL_L),
        ('ROUNDEDCORNERS', [6, 6, 6, 6]),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('TOPPADDING', (0,0), (-1,-1), 7),
        ('BOTTOMPADDING', (0,0), (-1,-1), 7),
        ('LEFTPADDING', (0,0), (0,0), 10),
        ('LEFTPADDING', (1,0), (1,0), 6),
    ]))
    return t

def day_table(days_data):
    col_w = [22*mm, 22*mm, 25*mm, 40*mm, 54*mm]
    header = [
        Paragraph('<b>Dias</b>', label),
        Paragraph('<b>Proteína</b>', label),
        Paragraph('<b>Treino</b>', label),
        Paragraph('<b>Foco alimentar</b>', label),
        Paragraph('<b>Ação principal</b>', label),
    ]
    rows = [header]
    for d in days_data:
        rows.append([Paragraph(x, body) for x in d])
    t = Table(rows, colWidths=col_w, repeatRows=1)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), LIGHT),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [WHITE, colors.HexColor('#F5F0E8')]),
        ('GRID', (0,0), (-1,-1), 0.4, colors.HexColor('#D8CFBF')),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('TOPPADDING', (0,0), (-1,-1), 5),
        ('BOTTOMPADDING', (0,0), (-1,-1), 5),
        ('LEFTPADDING', (0,0), (-1,-1), 5),
        ('RIGHTPADDING', (0,0), (-1,-1), 5),
    ]))
    return t

story = []

# CAPA
story.append(Spacer(1, 12*mm))
story.append(Paragraph('BÔNUS EXCLUSIVO', cover_tag))
story.append(Paragraph('Plano de 30 Dias<br/>Pós-Tratamento', cover_title))
story.append(Spacer(1, 3*mm))
story.append(Paragraph('O roteiro semana a semana para parar o Ozempic<br/>sem ver o peso voltar.', cover_sub))
story.append(Spacer(1, 8*mm))
story.append(HRFlowable(width='100%', thickness=1, color=GOLD))
story.append(Spacer(1, 5*mm))

story.append(Paragraph('Como usar este plano', section_h))
story.append(Paragraph(
    'Este bônus é um complemento prático ao Capítulo 08 do Caneta Sem Medo. '
    'Ele traduz os princípios do ebook em ações concretas para cada semana do mês seguinte ao fim do tratamento. '
    'Siga a sequência — cada semana prepara o terreno para a próxima.', body))
story.append(Spacer(1, 3*mm))

# SEMANA 1
story.append(week_header(1, 'Estabilização — Seu corpo está se recalibrando', 'Foco: proteína e movimento leve'))
story.append(Spacer(1, 2*mm))
story.append(Paragraph(
    'O apetite vai aumentar gradualmente. O objetivo desta semana <b>não é perder peso</b> — é não ganhar. '
    'Mantenha a proteína alta e não corte calorias abruptamente.', body))
story.append(day_table([
    ['Dias 1–2', '1,6g/kg', 'Caminhada 20min', 'Proteína em cada refeição', 'Pese os alimentos — restabeleça noção de porções'],
    ['Dias 3–4', '1,6g/kg', 'Treino força leve', 'Evitar ultraprocessados', 'Registre fome de 1–10 antes de comer'],
    ['Dias 5–7', '1,8g/kg', 'Treino força + caminhada', 'Vegetais em metade do prato', 'Monte o cardápio da semana 2 com antecedência'],
]))
story.append(Spacer(1, 2*mm))
story.append(Paragraph('Dica da semana: Se a fome vier forte à noite, antecipe o jantar e adicione 20g de proteína na última refeição.', tip_s))

story.append(Spacer(1, 4*mm))

# SEMANA 2
story.append(week_header(2, 'Consolidação — Construindo o hábito', 'Foco: consistência no treino'))
story.append(Spacer(1, 2*mm))
story.append(Paragraph(
    'O apetite estará mais presente. Esta semana foca em tornar o treino de força um hábito fixo '
    'e em ajustar as porções sem entrar em déficit agressivo.', body))
story.append(day_table([
    ['Dias 8–9',  '1,8g/kg', 'Força (inferior)', 'Proteína no café da manhã', 'Agende os 2 treinos da semana no calendário'],
    ['Dias 10–11', '1,8g/kg', 'Descanso ativo', 'Frutas no lugar de doces', 'Avalie o sono — ajuste horário se necessário'],
    ['Dias 12–14', '2,0g/kg', 'Força (superior)', 'Reduzir sódio e industrializados', 'Tire medidas (cintura) — não peso na balança'],
]))
story.append(Spacer(1, 2*mm))
story.append(Paragraph('Dica da semana: Peso na balança pode subir levemente por retenção hídrica. É normal. Confie nas medidas e no espelho.', tip_s))

story.append(Spacer(1, 4*mm))

# SEMANA 3
story.append(week_header(3, 'Adaptação — Ajuste fino', 'Foco: saciedade e composição'))
story.append(Spacer(1, 2*mm))
story.append(Paragraph(
    'Seu metabolismo está se ajustando. Esta semana avaliamos o que está funcionando e fazemos '
    'pequenos ajustes. O objetivo é comer bem sem contar calorias obsessivamente.', body))
story.append(day_table([
    ['Dias 15–16', '2,0g/kg', 'Força + 15min cardio', 'Fibras: feijão, aveia, vegetais', 'Identifique o horário de maior fome e planeje lanche proteico'],
    ['Dias 17–18', '2,0g/kg', 'Caminhada 30min', 'Hidratação: 35ml/kg/dia', 'Revise o que comeu na semana sem julgamento'],
    ['Dias 19–21', '2,0g/kg', 'Treino força completo', 'Refeição social sem culpa', 'Planeje como manter o padrão na semana 4'],
]))
story.append(Spacer(1, 2*mm))
story.append(Paragraph('Dica da semana: Uma refeição "fora do plano" não apaga a semana. O que importa é o padrão dos 7 dias, não de uma refeição.', tip_s))

story.append(Spacer(1, 4*mm))

# SEMANA 4
story.append(week_header(4, 'Sustentabilidade — Seu novo normal', 'Foco: autonomia e longo prazo'))
story.append(Spacer(1, 2*mm))
story.append(Paragraph(
    'Esta semana é sobre tornar tudo isso <b>automático</b>. O plano de saída funcionou se você chegar aqui '
    'sem sentir que está "fazendo dieta" — mas vivendo diferente.', body))
story.append(day_table([
    ['Dias 22–23', '2,0g/kg', 'Força (inferior)', 'Comer devagar — 20min por refeição', 'Avalie: o que você vai manter para sempre?'],
    ['Dias 24–25', '2,0g/kg', 'Força (superior)', 'Proteína continua prioridade', 'Marque retorno médico nos próximos 30 dias'],
    ['Dias 26–28', '2,0g/kg', 'Treino + caminhada', 'Refeições sem tela', 'Monte seu cardápio modelo para o próximo mês'],
    ['Dias 29–30', '2,0g/kg', 'Treino livre', 'Celebre com uma refeição especial', 'Tire fotos e medidas — compare com o dia 1'],
]))
story.append(Spacer(1, 2*mm))
story.append(Paragraph('Dica da semana: Se o peso estiver estável e você estiver dormindo bem, treinando e comendo proteína — você venceu o rebound.', tip_s))

story.append(Spacer(1, 4*mm))
story.append(HRFlowable(width='100%', thickness=1, color=GOLD))
story.append(Spacer(1, 3*mm))

# CHECKLIST FINAL
story.append(Paragraph('Checklist dos 30 dias — o que significa sucesso', section_h))

checklist = [
    ('Peso estável', 'Variação de até ±2kg em relação ao peso no fim do tratamento é normal e saudável.'),
    ('Treino consolidado', '2 sessões de força por semana viraram hábito — sem precisar de motivação extra.'),
    ('Proteína no piloto automático', 'Você já sabe intuitivamente montar um prato com proteína suficiente.'),
    ('Fome reconhecida', 'Você consegue distinguir fome física de fome emocional na maioria das vezes.'),
    ('Sem regras rígidas', 'Você come com flexibilidade, sem culpa, e volta ao padrão no dia seguinte.'),
]
for item, desc in checklist:
    story.append(Paragraph(f'<b>☐  {item}</b>', body))
    story.append(Paragraph(desc, tip_s))

story.append(Spacer(1, 4*mm))
story.append(HRFlowable(width='100%', thickness=0.5, color=LIGHT))
story.append(Spacer(1, 3*mm))
story.append(Paragraph(
    'Este material é um bônus do e-book Caneta Sem Medo. Conteúdo educacional — não substitui acompanhamento médico ou nutricional.',
    footer_s))

doc.build(story, onFirstPage=bg, onLaterPages=bg)
print('PDF criado: Plano_30_Dias_Pos_Tratamento.pdf')
