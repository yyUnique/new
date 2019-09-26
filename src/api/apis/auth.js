import fetch from '../request'
//  访问登录
export const loginToken = (params) => {
  return fetch.get('/login/get/token', {
    params,
    unPrivate: true
  })
};
//获取图片验证码
export const imageCode = (params) => {
  return fetch.get('/login/get/img', {
    params,
    responseType: 'blob',
    unPrivate: false
  })
};
// 账号密码  登录
export const login = (params) => {
  return fetch.post('/login/user/login', params, {
    unPrivate: false
  })
};
//获取用户菜单
export const menuList = (params) => {
  return fetch.get('/user/menu/list', {
    params
  })
};
//获取登录用户信息
export const userInfo = (params) => {
  return fetch.get('/user/get/info', {
    params
  })
}
//退出登陆
export const logOut = (params) => {
  return fetch.get('/login/out/login', {
    params
  })
}