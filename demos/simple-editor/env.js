const env = {
  // entry: './src/index.polkadot.js',
  entry: './src/index.polkadot.js',
  officialRemote: 'polkadot',
  pinner: {
    url: 'http://localhost:3000',
    Swarm: [
      '/dns4/wrtc-star1.par.dwebops.pub/tcp/443/wss/p2p-webrtc-star/',
      '/dns4/wrtc-star2.sjc.dwebops.pub/tcp/443/wss/p2p-webrtc-star/',
      '/dns4/webrtc-star.discovery.libp2p.io/tcp/443/wss/p2p-webrtc-star/'
    ],
    Bootstrap: ['/ip4/192.168.1.13/tcp/4003/ws/p2p/QmXJTMaeckNpzWFviw6Fhh848n2iwMTJe96RfVyGQFvfpw']
  },
  ethers: {
    apiKeys: {
      etherscan: '6H4I43M46DJ4IJ9KKR8SFF1MF2TMUQTS2F',
      infura: '73e0929fc849451dae4662585aea9a7b'
    }
  }
};

module.exports = {
  env
};
