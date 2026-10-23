import type { Messages } from '../i18n/en';

export type PaymentMethod = keyof Messages['buyUsdt']['methods'];

export interface UsdtProvider {
  abbr: string;
  name: string;
  methods: PaymentMethod[];
  fee: string;
  min: string;
  networks: string;
  url: string;
}

// Placeholders until partner sites are confirmed.
export const USDT_PROVIDERS: UsdtProvider[] = [
  { abbr: 'A', name: '[Provider A]', methods: ['card', 'applePay', 'googlePay'], fee: '[x.x%]', min: '[$xx]', networks: 'TRC20 · Polygon', url: 'https://example.com' },
  { abbr: 'B', name: '[Provider B]', methods: ['bankTransfer', 'card'], fee: '[x.x%]', min: '[$xx]', networks: 'ERC20 · TRC20', url: 'https://example.com' },
  { abbr: 'C', name: '[Provider C]', methods: ['p2p', 'localBank'], fee: '[x.x%]', min: '[$xx]', networks: 'TRC20 · BEP20', url: 'https://example.com' },
];

export const methodList = (t: Messages, methods: PaymentMethod[]) => methods.map((m) => t.buyUsdt.methods[m]).join(' · ');
