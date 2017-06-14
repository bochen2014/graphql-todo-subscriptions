import {List,Record} from 'immutable';

import {
  GraphQLBoolean,
  GraphQLFieldConfig,
  GraphQLInt,
  GraphQLInputObjectType,
  GraphQLNonNull,
  GraphQLList,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
} from 'graphql';

import {db} from './database';
import {events} from './events';

const UserType = new GraphQLObjectType({
  name: 'User',
  fields: {
    id: { type: GraphQLString }
  }
});

const TodoType = new GraphQLObjectType({
  name: 'Todo',
  fields: {
    id: { type: GraphQLString },
    text: { type: GraphQLString },
    completed: { type: GraphQLBoolean }
  }
});

const SubscriptionType = new GraphQLObjectType({
  name: 'Subscription',
  fields: () => ({
    id: { type: GraphQLString },
    clientSubscriptionId: { type: GraphQLString },
    client: {
      type: WebsocketClientType,
      resolve: sub => db.getClient(sub.clientId)
    },
    events: { type: new GraphQLList(GraphQLString) }
  })
});

const WebsocketClientType = new GraphQLObjectType({
  name: 'WebsocketClient',
  fields: {
    id: { type: GraphQLString },
    type: { type: GraphQLString },
    socketId: { type: GraphQLString },
    user: {
      type: UserType,
      resolve: client => db.getUser(client.userId)
    },
    subscriptions: {
      type: new GraphQLList(SubscriptionType),
      resolve: client => db.getSubscriptions(client.id).toArray()
    }
  }
})

const ViewerType = new GraphQLObjectType({
  name: 'Viewer',
  fields: {
    id: { type: GraphQLString },
    todos: {
      type: new GraphQLList(TodoType),
      resolve: (viewer) => db.getTodos(viewer.id).toArray()
    },
    clients: {
      type: new GraphQLList(WebsocketClientType),
      resolve: (viewer) => db.getClients(viewer.id).toArray()
    },
    subscriptions: {
      type: new GraphQLList(SubscriptionType),
      resolve: (viewer) => {
        const clients = db.getClients(viewer.id);
        return clients.flatMap(client =>
          db.getSubscriptions(client.id)
        ).toArray();
      }
    }
  }
});

const QueryRootType = new GraphQLObjectType({
  name: 'QueryRoot',
  fields: {
    viewer: { type: ViewerType, resolve: ({user}) => user }
  }
});

const AddTodoMutation = {
  type: TodoType,
  args: {
    text: { type: GraphQLString }
  },
  resolve: ({user}, {text}) => {
    return db.addTodo(user.id, text);
  }
};

const AddTodoSubscriptionPayloadType = new GraphQLObjectType({
  name: 'AddTodoSubscriptionPayload',
  fields: {
    clientSubscriptionId: {
      type: GraphQLString,
      resolve: ({subscription}) => subscription.clientSubscriptionId
    },
    subscription: {
      type: SubscriptionType,
      resolve: ({subscription}) => subscription
    },
    todo: {
      type: TodoType,
      resolve: ({event}) => event ? db.getTodo(event.todoId) : null
    }
  }
});

// the subscription root has the form of:
// {
//   event: event payload, can be null,
//   clientSubscriptionId: the client subscription id corresponding to the event payload
// }
//
// if a query is being run in response to a subscription then the client ids will match
// if so, this event belongs to the subscription
// if not, the event does not belong to the subscription and the subscription
// should return an empty event payload
const eventForClientSubscriptionId = (subscriptionRoot, clientSubscriptionId) => {
  if (subscriptionRoot && subscriptionRoot.clientSubscriptionId === clientSubscriptionId) {
    return subscriptionRoot.event
  }
}

const AddTodoSubscription = {
  type: AddTodoSubscriptionPayloadType,
  args: {
    clientSubscriptionId: { type: GraphQLString }
  },
  resolve: ({user,client,request,subscription:subscriptionRoot}, {clientSubscriptionId}) => {
    let subscription = db.getClientSubscription(client.id, clientSubscriptionId);

    if (!subscription) {
      subscription = db.addSubscription(
        client.id,
        clientSubscriptionId,
        [`${user.id}.todo.add`],
        request
      );
    }

    return {
      subscription,
      event: eventForClientSubscriptionId(subscriptionRoot, clientSubscriptionId)
    };
  }
}

const DeleteTodoMutation = {
  type: GraphQLString,
  args: {
    id: { type: new GraphQLNonNull(GraphQLString) }
  },
  resolve: ({user}, {id}) => {
    if(db.deleteTodo(id)) {
      return id
    }
  }
}

const DeleteTodoSubscriptionPayloadType = new GraphQLObjectType({
  name: 'DeleteTodoSubscriptionPayload',
  fields: {
    clientSubscriptionId: {
      type: GraphQLString,
      resolve: ({subscription}) => subscription.clientSubscriptionId
    },
    subscription: {
      type: SubscriptionType,
      resolve: ({subscription}) => subscription
    },
    deletedTodoId: {
      type: GraphQLString,
      resolve: ({event}) => event ? event.todoId : null
    }
  }
});

const DeleteTodoSubscription = {
  type: DeleteTodoSubscriptionPayloadType,
  args: {
    clientSubscriptionId: { type: new GraphQLNonNull(GraphQLString) }
  },
  resolve: ({user,client,request,subscription:subscriptionRoot}, {clientSubscriptionId}, {variableValues}) => {
    let subscription = db.getClientSubscription(client.id, clientSubscriptionId);

    if (!subscription) {
      subscription = db.addSubscription(
        client.id,
        clientSubscriptionId,
        [`${user.id}.todo.remove`],
        request
      );
    }

    return {
      subscription,
      event: eventForClientSubscriptionId(subscriptionRoot, clientSubscriptionId)
    };
  }
}

const ChangeTodoStatusMutation = {
  type: TodoType,
  args: {
    id: { type: new GraphQLNonNull(GraphQLString) },
    completed: { type: new GraphQLNonNull(GraphQLBoolean) }
  },
  resolve: ({user}, {id, completed}) => {
    return db.changeTodoStatus(id, completed);
  }
};

const ChangeTodoStatusSubscriptionPayloadType = new GraphQLObjectType({
  name: 'ChangeTodoStatusSubscriptionPayload',
  fields: {
    clientSubscriptionId: {
      type: GraphQLString,
      resolve: ({subscription}) => subscription.clientSubscriptionId
    },
    subscription: {
      type: SubscriptionType,
      resolve: ({subscription}) => subscription
    },
    todo: {
      type: TodoType,
      resolve: ({event}) => event ? db.getTodo(event.todoId) : null
    }
  }
});

const ChangeTodoStatusSubscription = {
  type: ChangeTodoStatusSubscriptionPayloadType,
  args: {
    clientSubscriptionId: { type: new GraphQLNonNull(GraphQLString) }
  },
  //https://github.com/graphql/graphql-js/pull/189
  resolve: ({user,client,request,subscription:subscriptionRoot}, {clientSubscriptionId /*this is client generated subscriptionId*/}, {variableValues}) => {
    let subscription = db.getClientSubscription(client.id, clientSubscriptionId);

    if (!subscription) {
      subscription = db.addSubscription(
        client.id,
        clientSubscriptionId,
        [`${user.id}.todo.change_status`], // same as emmitter2.on('todo.change_status'). we just do it in workers.js#startWorkers
        request // When the resolve occurs, the GraphQL server would do SOMETHING to store this query somewhere (could be in-memory or Redis), 
      );
    }

    return {
      subscription, //and would return back a subscriptionId that the client could use to listen for updates
      event: eventForClientSubscriptionId(subscriptionRoot, clientSubscriptionId)
    };
  }
}

const TodosSubscriptionPayloadType = new GraphQLObjectType({
  name: 'TodosSubscriptionPayloadType',
  fields: {
    clientSubscriptionId: {
      type: GraphQLString,
      resolve: ({subscription}) => subscription.clientSubscriptionId
    },
    subscription: {
      type: SubscriptionType,
      resolve: ({subscription}) => subscription
    },
    todos: {
      type: new GraphQLList(TodoType),
      resolve: ({user}) => db.getTodos(user.id).toArray()
    }
  }
});

const TodoSubscription = {
  type: TodosSubscriptionPayloadType,
  args: {
    clientSubscriptionId: { type: new GraphQLNonNull(GraphQLString) }
  },
  resolve: ({user,client,request}, {clientSubscriptionId}, {variableValues}) => {
    let subscription = db.getClientSubscription(client.id, clientSubscriptionId);

    if (!subscription) {
      subscription = db.addSubscription(
        client.id,
        clientSubscriptionId,
        [
          `${user.id}.todo.change_status`,
          `${user.id}.todo.add`,
          `${user.id}.todo.delete`
        ],
        request
      );
    }

    return {
      subscription,
      user
    }
  }
}

const SubscriptionSubscription = {
  type: ViewerType,
  args: {
    clientSubscriptionId: { type: new GraphQLNonNull(GraphQLString) }
  },
  resolve: ({user,client,request}, {clientSubscriptionId}) => {
    let subscription = db.getClientSubscription(client.id, clientSubscriptionId);

    if (!subscription) {
      subscription = db.addSubscription(
        client.id,
        clientSubscriptionId,
        [
          `${user.id}.client.add`,
          `${user.id}.client.remove`,
          `${user.id}.subscription.add`,
          `${user.id}.subscription.remove`,
        ],
        request
      );
    }

    return user;
  }
}

const MutationRootType = new GraphQLObjectType({
  name: 'MutationRoot',
  fields: {
    addTodo: AddTodoMutation,
    deleteTodo: DeleteTodoMutation,
    changeTodoStatus: ChangeTodoStatusMutation
  }
});

const SubscriptionRootType = new GraphQLObjectType({
  name: 'SubscriptionRoot',
  fields: {
    addTodo: AddTodoSubscription,
    deleteTodo: DeleteTodoSubscription,
    changeTodoStatus: ChangeTodoStatusSubscription,
    todos: TodoSubscription,
    subscriptions: SubscriptionSubscription
  }
})

export const schema = new GraphQLSchema({
  query: QueryRootType,
  mutation: MutationRootType,
  subscription: SubscriptionRootType
});
