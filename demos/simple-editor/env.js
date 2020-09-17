const env = {
  // entry: './src/index.polkadot.js',
  // officialRemote: 'polkadot',
  entry: './src/index.orbitdb.js',
  officialRemote: 'eth',
  pinner: {
    url: 'http://localhost:3000',
    Swarm: ['/dns4/wrtc-star1.par.dwebops.pub/tcp/443/wss/p2p-webrtc-star/'],
    Bootstrap: ['/ip4/192.168.0.108/tcp/4003/ws/p2p/QmUbLFpzX7hj7VHX75bBo63xD2AadiQdyW74bRQSqCroGF']
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