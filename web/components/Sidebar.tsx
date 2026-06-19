'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, CalendarDays, Users, DollarSign,
  Scissors, UserCog, Package, Gift, BarChart2,
  Bell, Settings, LogOut, Receipt, ShoppingCart, MoreHorizontal,
  Banknote,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useState, useEffect } from 'react';
import Image from 'next/image';

const supabase = createClient();

// Itens principais da sidebar desktop
const NAV = [
  { href: '/dashboard',    label: 'Dashboard',   icon: LayoutDashboard },
  { href: '/agenda',       label: 'Agenda',       icon: CalendarDays    },
  { href: '/comanda',      label: 'Comanda',      icon: Receipt         },
  { href: '/vendas',       label: 'Vendas',       icon: ShoppingCart    },
  { href: '/clientes',     label: 'Clientes',     icon: Users           },
  { href: '/financeiro',   label: 'Financeiro',   icon: DollarSign      },
  { href: '/servicos',     label: 'Serviços',     icon: Scissors        },
  { href: '/pacotes',      label: 'Pacotes',      icon: Gift            },
  { href: '/equipe',       label: 'Equipe',       icon: UserCog         },
  { href: '/comissoes',    label: 'Comissões',    icon: Banknote        },
  { href: '/estoque',      label: 'Estoque',      icon: Package         },
  { href: '/relatorios',   label: 'Relatórios',   icon: BarChart2       },
];

const BOTTOM_NAV_DESKTOP = [
  { href: '/notificacoes',  label: 'Notificações', icon: Bell     },
  { href: '/configuracoes', label: 'Configurações', icon: Settings },
];

// 5 abas do bottom nav mobile (design Bellamore)
const MOBILE_NAV = [
  { href: '/dashboard',  label: 'Início',     icon: LayoutDashboard },
  { href: '/agenda',     label: 'Agenda',     icon: CalendarDays    },
  { href: '/clientes',   label: 'Clientes',   icon: Users           },
  { href: '/financeiro', label: 'Financeiro', icon: DollarSign      },
  { href: '/mais',       label: 'Mais',       icon: MoreHorizontal  },
];

export default function Sidebar({ empresaNome, empresaLogo, empresaSegmento }: { empresaNome: string; empresaLogo: string | null; empresaSegmento: string }) {
  const pathname        = usePathname();
  const router          = useRouter();
  const [alertCount,     setAlertCount]     = useState(0);
  const [comissoesCount, setComissoesCount] = useState(0);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: membro } = await supabase
        .from('empresa_membros').select('empresa_id')
        .eq('user_id', user.id).eq('ativo', true).limit(1).single();
      if (!membro) return;

      const hoje   = new Date().toISOString().slice(0, 10);
      const daqui7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      const empId  = membro.empresa_id;

      const [estoque, despesas, comissoes] = await Promise.all([
        supabase.from('produtos').select('id', { count: 'exact', head: true })
          .eq('empresa_id', empId).eq('ativo', true)
          .filter('estoque_atual', 'lte', 'estoque_minimo'),
        supabase.from('despesas').select('id', { count: 'exact', head: true })
          .eq('empresa_id', empId).eq('status', 'pendente')
          .gte('data_vencimento', hoje).lte('data_vencimento', daqui7),
        supabase.from('comissoes').select('id', { count: 'exact', head: true })
          .eq('empresa_id', empId).eq('status', 'pendente'),
      ]);

      const comCount = comissoes.count ?? 0;
      setComissoesCount(comCount);
      const total = (estoque.count ?? 0) + (despesas.count ?? 0) + (comCount > 0 ? 1 : 0);
      setAlertCount(total);
    })();
  }, []);

  async function sair() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  function isActive(href: string) {
    if (href === '/dashboard') return pathname === href;
    return pathname.startsWith(href);
  }

  return (
    <>
      {/* ── Sidebar desktop ──────────────────────────────────── */}
      <aside className="hidden md:flex fixed top-0 left-0 h-screen w-60 flex-col z-40"
        style={{ background: 'var(--color-surface)', borderRight: '1px solid var(--color-border)' }}>

        {/* Logo / empresa */}
        <div className="px-5 py-5" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-3">
            {empresaLogo ? (
              <Image src={empresaLogo} alt={empresaNome} width={36} height={36} unoptimized
                className="w-9 h-9 rounded-xl object-contain flex-shrink-0"
                style={{ boxShadow: '0 2px 8px rgba(44,23,80,0.2)', background: '#fff' }} />
            ) : (
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'var(--color-primary)', boxShadow: '0 2px 8px rgba(44,23,80,0.3)' }}>
                <span className="text-white text-sm font-bold" style={{ fontFamily: 'var(--font-serif)' }}>✦</span>
              </div>
            )}
            <div className="min-w-0">
              <p className="text-xs font-semibold truncate" style={{ color: 'var(--color-ink3)', letterSpacing: '0.05em' }}>{empresaSegmento}</p>
              <p className="text-sm font-bold truncate" style={{ color: 'var(--color-ink)', lineHeight: 1.2 }}>{empresaNome}</p>
            </div>
          </div>
        </div>

        {/* Nav principal */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 flex flex-col gap-0.5">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link key={href} href={href}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150"
                style={{
                  color:      active ? 'var(--color-primary)' : 'var(--color-ink3)',
                  background: active ? 'var(--color-primary-soft)' : 'transparent',
                  fontWeight: active ? 700 : 500,
                }}
              >
                <Icon size={15} strokeWidth={active ? 2.5 : 2} />
                {label}
                {href === '/comissoes' && comissoesCount > 0 && (
                  <span className="ml-auto text-[10px] font-bold text-white px-1.5 py-0.5 rounded-full min-w-[18px] text-center leading-none"
                    style={{ background: 'var(--color-amber)' }}>
                    {comissoesCount > 99 ? '99+' : comissoesCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Nav inferior */}
        <div className="px-3 pb-4 flex flex-col gap-0.5 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
          {BOTTOM_NAV_DESKTOP.map(({ href, label, icon: Icon }) => {
            const active  = pathname === href;
            const isNotif = href === '/notificacoes';
            return (
              <Link key={href} href={href}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-150"
                style={{
                  color:      active ? 'var(--color-primary)' : 'var(--color-ink3)',
                  background: active ? 'var(--color-primary-soft)' : 'transparent',
                  fontWeight: active ? 700 : 500,
                }}
              >
                <Icon size={15} strokeWidth={active ? 2.5 : 2} />
                {label}
                {isNotif && alertCount > 0 && (
                  <span className="ml-auto text-[10px] font-bold text-white px-1.5 py-0.5 rounded-full min-w-[18px] text-center leading-none"
                    style={{ background: 'var(--color-rose)' }}>
                    {alertCount > 9 ? '9+' : alertCount}
                  </span>
                )}
              </Link>
            );
          })}

          <button onClick={sair}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium w-full text-left transition-colors duration-150"
            style={{ color: 'var(--color-rose)' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-rose-soft)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <LogOut size={15} strokeWidth={2} />
            Sair
          </button>
        </div>
      </aside>

      {/* ── Bottom nav mobile ─────────────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 flex"
        style={{
          background:    'rgba(251,248,244,0.92)',
          backdropFilter:'blur(28px) saturate(200%)',
          WebkitBackdropFilter: 'blur(28px) saturate(200%)',
          borderTop:     '1px solid var(--color-border-soft)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}>
        {MOBILE_NAV.map(({ href, label, icon: Icon }) => {
          const active = href === '/mais'
            ? ['/servicos','/equipe','/estoque','/pacotes','/relatorios','/configuracoes','/notificacoes','/mais'].some(p => pathname.startsWith(p))
            : isActive(href);
          return (
            <Link key={href} href={href === '/mais' ? '/configuracoes' : href}
              className="flex-1 flex flex-col items-center justify-center py-2 gap-1 transition-all duration-150 press"
            >
              <div className={`flex items-center justify-center${active ? ' bm-pop' : ''}`}
                style={{
                  width: 48, height: 30, borderRadius: 10,
                  background: active ? 'var(--color-primary-soft)' : 'transparent',
                  transition: 'background 150ms ease',
                }}>
                <Icon size={20} strokeWidth={active ? 2.5 : 1.9}
                  style={{ color: active ? 'var(--color-primary)' : 'var(--color-ink4)' }} />
              </div>
              <span className="text-[10.5px] font-semibold leading-none"
                style={{
                  color:      active ? 'var(--color-primary)' : 'var(--color-ink4)',
                  fontFamily: 'var(--font-sans)',
                  fontWeight: active ? 700 : 500,
                }}>
                {label}
              </span>
              {href === '/agenda' && alertCount > 0 && (
                <span className="absolute top-1.5 right-[calc(50%-6px)] w-1.5 h-1.5 rounded-full"
                  style={{ background: 'var(--color-rose)' }} />
              )}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
