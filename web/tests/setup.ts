// Fuso fixo nos testes: nada depende do fuso da máquina (CI em UTC, dev em Brasília).
process.env.TZ = 'America/Sao_Paulo';
import '@testing-library/jest-dom';
