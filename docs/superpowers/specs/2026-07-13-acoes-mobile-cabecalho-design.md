# Acoes de cabecalho no mobile — Design

**Status:** aprovado pelo usuario em 2026-07-13.

## Objetivo

Corrigir a hierarquia e a legibilidade dos controles de cabecalho em telas pequenas, sem alterar os dados exportados nem o comportamento desktop.

## Escopo

### Exportacao

- Nas telas Clientes, Financeiro, Servicos, Pacotes, Equipe, Comissoes, Relatorios, Estoque e Agenda, o controle existente `ExportButton` passa a ocupar o canto superior direito do cabecalho no mobile.
- O botao usa preenchimento rosa do sistema visual, texto `Exportar`, icone de download, altura minima de 44 px e mantem o menu existente de PDF/XLSX.
- A variante rosa e de posicionamento deve ser reutilizavel; as telas continuam fornecendo somente os dados e colunas que ja exportam.
- A aparencia e o posicionamento desktop atuais permanecem inalterados.

### Estoque

- Depois de retirar Exportar da linha de acoes, `Historico geral` e `Novo produto` ocupam duas colunas de mesma largura no mobile.
- Os dois rotulos permanecem completos em uma linha, sem quebra visual.

### Comanda

- O seletor Semana/Mes permanece funcional, mas fica alinhado ao canto direito da linha do titulo no mobile, afastado visualmente de `Comanda`.
- A faixa de dias e as navegacoes de semana/mes nao mudam.

### Agenda

- O cabecalho recebe o mesmo Exportar rosa no canto superior direito; Bloquear e Novo permanecem na linha de acoes abaixo.
- Na Timeline, o nome da profissional deixa de ser abreviado e pode ocupar a largura disponivel.
- A coluna dos horarios fica mais estreita no mobile, liberando mais largura para a coluna da profissional e para os agendamentos.

## Restricoes

- Sem novas tabelas, migrations, chamadas Supabase ou bibliotecas.
- Os alvos de toque permanecem com no minimo 44 px.
- As alteracoes devem funcionar em 375 px de largura e respeitar o espaco da navegacao inferior existente.
- Nao duplicar a logica de exportacao nem remover formatos existentes.

## Validacao

- Testes de regressao verificam a variante rosa, o reposicionamento nos nove cabecalhos, as acoes de Estoque e as regras da Timeline/Comanda.
- Executar a suite Vitest completa e `npx.cmd tsc --noEmit`.
- Fazer uma verificacao visual em viewport mobile quando o navegador de teste estiver disponivel.
