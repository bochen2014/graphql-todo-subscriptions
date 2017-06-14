import {graphql} from 'graphql';
import {Map,List,Record} from 'immutable';

import {schema} from '../data/schema';
import {db} from '../data/database';
import {events} from '../data/events';

// keep track of subscription handlers so we can remove them!
let handlers = Map();

const Handler = Record({type: undefined, callback: undefined });

export const startWorkers = () => {
  events.on('subscription.new', handleSubscriptionNew);
  events.on('subscription.delete.*', handleSubscriptionDelete);
}

// when a new subscription is made we start up a listener
// for each of the subscription events
const handleSubscriptionNew = ({subscriptionId}) => {
  const subscription = db.getSubscription(subscriptionId);

  handlers = handlers.set(
    subscriptionId,
    List(subscription.events /*the event types that current subscription is registered for*/ ).map(ev => {
      return Handler({
        type: ev,
        callback: handleSubscriptionEvent.bind(null, subscription)
      });
    })
  );

  // start'em up!
  handlers
    .get(subscriptionId)
    .forEach(handler => {
      // here we start listening to redis/rabbit mq events (topics)
      events.on(handler.type, handler.callback);
    });
}

// when the subscription is deleted we remove all those listeners
const handleSubscriptionDelete = ({subscriptionId}) => {
  handlers.get(subscriptionId).forEach(handler => {
    events.removeListener(handler.type, handler.callback);
  });

  handlers = handlers.delete(subscriptionId);
}

/*
When a change happens in the backend, it would figure out (in some user-land described way) which subscriptions needed to be notified. The process that's listening for these changes would take the subscriber query and execute it,
 */
const handleSubscriptionEvent = (subscription, event) => {
  const client = db.getClient(subscription.clientId);
  const user = db.getUser(client.userId);

  const {request,clientSubscriptionId} = subscription;
  const {query,variables} = request;

  const rootValue = {
    user,
    client,

    request,

    subscription: {
      clientSubscriptionId,
      event
    }
  }
  // a rabbitMQ/redis (pub) message/event comes in and I (Sub) need to update graphql client
  // 1. run graphql to get the updated payload
  graphql(schema, query, rootValue, variables)
    .then(response => {
      // 2. publicize to socket.io server (which is the Sub)
      events.emit(`${subscription.clientId}.graphql.subscription`, response);
    });
}
