export interface UsdtProvider {
  abbr: string;
  name: string;
  methods: string;
  fee: string;
  min: string;
  networks: string;
  url: string;
}

// Placeholders until partner sites are confirmed.
export const USDT_PROVIDERS: UsdtProvider[] = [
  { abbr: 'A', name: '[Provider A]', methods: 'Bank card · Apple Pay · Google Pay', fee: '[x.x%]', min: '[$xx]', networks: 'TRC20 · Polygon', url: 'https://example.com' },
  { abbr: 'B', name: '[Provider B]', methods: 'Bank transfer · Bank card', fee: '[x.x%]', min: '[$xx]', networks: 'ERC20 · TRC20', url: 'https://example.com' },
  { abbr: 'C', name: '[Provider C]', methods: 'P2P · Local bank transfer', fee: '[x.x%]', min: '[$xx]', networks: 'TRC20 · BEP20', url: 'https://example.com' },
];
