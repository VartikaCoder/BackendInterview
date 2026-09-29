// In-memory auction. Same contract as Mongo findOneAndUpdate:
// check + write must be one critical section.

const auctions = new Map();

auctions.set('a1', {
  id: 'a1',
  status: 'open',
  endsAt: Date.now() + 60_000,
  currentBid: 100,
  currentBidder: null,
  bidHistory: []
});

// Tiny async mutex so overlapping placeBid calls queue instead of racing
function createMutex() {
  let chain = Promise.resolve();
  return function lock() {
    let release;
    const next = new Promise((res) => {
      release = res;
    });
    const wait = chain.then(() => release);
    chain = chain.then(() => next);
    return wait;
  };
}

const mutex = createMutex();

async function placeBid(auctionId, buyerId, amount) {
  const unlock = await mutex();
  try {
    const auction = auctions.get(auctionId);
    if (!auction) throw new Error('Auction not found');
    if (auction.status !== 'open') throw new Error('Auction closed');
    if (Date.now() >= auction.endsAt) throw new Error('Auction expired');
    if (!(amount > auction.currentBid)) {
      throw new Error(
        `Bid too low: ${amount} <= current ${auction.currentBid}`
      );
    }

    auction.currentBid = amount;
    auction.currentBidder = buyerId;
    auction.lastBidTime = Date.now();
    auction.bidHistory.push({ bidder: buyerId, amount, ts: Date.now() });
    return { ...auction, bidHistory: [...auction.bidHistory] };
  } finally {
    unlock();
  }
}

// --- runner: 100 concurrent bids ---
async function main() {
  const bids = [];
  for (let i = 0; i < 100; i++) {
    const amount = 101 + i; // 101, 102, ... 200
    bids.push(
      placeBid('a1', `buyer-${i}`, amount)
        .then((r) => ({ ok: true, amount, bidder: r.currentBidder }))
        .catch((e) => ({ ok: false, amount, error: e.message }))
    );
  }

  const results = await Promise.all(bids);
  const wins = results.filter((r) => r.ok);
  const losses = results.filter((r) => !r.ok);
  const final = auctions.get('a1');

  console.log('wins:', wins.length);
  console.log('rejects:', losses.length);
  console.log('final high:', final.currentBid, 'by', final.currentBidder);
  console.log('history length:', final.bidHistory.length);
  console.log(
    'history is strictly increasing:',
    final.bidHistory.every((b, i, arr) => i === 0 || b.amount > arr[i - 1].amount)
  );
}

main();
