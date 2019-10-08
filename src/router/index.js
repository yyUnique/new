import Vue from 'vue'
import Router from 'vue-router'
import HelloWorld from '@/pages/index/HelloWorld'
import Index from '@/pages/index/index'
import Home from '@/pages/home/home'
Vue.use(Router)

export default new Router({
  routes: [
    {
      path: '/',
      name: 'Home',
      component: Home,
      children:[
        {
          path: '/',
          name: 'HelloWorld',
          component: HelloWorld
        },
        {
          path: '/index',
          name: 'Index',
          component: Index
        }    
      ]
    },
    
  ]
})
