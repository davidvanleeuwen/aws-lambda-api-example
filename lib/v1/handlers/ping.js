/**
 * `GET /api/v1/ping`
 *
 * @return {String} "pong"
 *
 * @handler v1_ping
 * @description v1 ping test
 * @role arn:aws:iam::739159924836:role/lambda_basic_execution
 */

export default function handler(event, context) {
  if(event) {
    context.succeed("pong");
  } else {
    context.fail(new Error("No event object received from API Gateway"));
  }
}