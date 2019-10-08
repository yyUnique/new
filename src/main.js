// The Vue build version to load with the `import` command
// (runtime-only or standalone) has been set in webpack.base.conf with an alias.
import Vue from 'vue'
import App from './App'
import router from './router'
import ElementUI from 'element-ui';
import 'element-ui/lib/theme-chalk/index.css';
import './common/style/flex.css'
import './common/style/common.scss'
import './common/style/variables.scss'
Vue.config.productionTip = false
Vue.use(ElementUI);

import {
  TokenKeys
} from './common/js/variable'
import {
  getSessionToken
} from './common/js/auth'

// router.beforeEach((to, from, next) => {
//   if (to.fullPath == '/') {
//     localStorage.removeItem(TokenKeys.ACCESS_TOKEN);
//   }
//   if (to.fullPath != '/' && !getSessionToken()) {
//     next({
//       path: '/'
//     })
//   } else {
//     next()
//   }
// });

/* eslint-disable no-new */
new Vue({
  el: '#app',
  router,
  components: { App },
  template: '<App/>'
})
