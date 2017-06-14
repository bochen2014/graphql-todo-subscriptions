GraphQL TODO Subscriptions
==========================

Just a small repo to try out the new GraphQL Subscriptions added in https://github.com/graphql/graphql-js/pull/189.

#pubSub

rabbitMQ/Redis  -- pub      emmiter2.emmit('AMQP.races:update',{*new time*})
       |
      \|/
    graphql server -- sub  emmiter2.on('AMQP.races:update')
    var new_payload = graphql(schema, <stored in memory>`subscripts(input:$input){ ... }`, {/*root value*/}, null /*context*/,  <stored in memory>{variables})
    emmiter2.emmit('graphql.races:udpate', {new_result /*new_payload must contains client subscription id*/})
       |
      \|/
    emitter2.on('graphql.races.update, new_payload:payload =>{
        socket.emit('subscription', payload/*payload must contains client subscription id*/)
    })
