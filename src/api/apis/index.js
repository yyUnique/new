import fetch from '../request'
//  访问登录
export const loginToken = (params) => {
  return fetch.get('/login/get/token', {
    params,
    unPrivate: true
  })
};